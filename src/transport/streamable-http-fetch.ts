// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  JSONRPCMessage,
  JSONRPCMessageSchema,
  RequestId,
  SUPPORTED_PROTOCOL_VERSIONS,
  isInitializeRequest,
  isJSONRPCError,
  isJSONRPCRequest,
  isJSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

export type StreamableHttpFetchTransportOptions = {
  sessionIdGenerator?: (() => string) | undefined;
  enableJsonResponse?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  enableDnsRebindingProtection?: boolean;
};

type StreamState = {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  pendingIds: Set<RequestId>;
};

type PendingJsonResponse = {
  resolve: (message: JSONRPCMessage) => void;
  reject: (error: Error) => void;
};

const ENCODER = new TextEncoder();

export class StreamableHttpFetchTransport implements Transport {
  private sessionIdGenerator: (() => string) | undefined;
  private _initialized = false;
  private _enableJsonResponse: boolean;
  private _allowedHosts?: string[];
  private _allowedOrigins?: string[];
  private _enableDnsRebindingProtection: boolean;

  private _standaloneStream?: StreamState;
  private _streams = new Map<string, StreamState>();
  private _requestToStream = new Map<RequestId, string>();
  private _pendingJsonResponses = new Map<RequestId, PendingJsonResponse>();

  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

  constructor(options: StreamableHttpFetchTransportOptions) {
    this.sessionIdGenerator = options.sessionIdGenerator;
    this._enableJsonResponse = options.enableJsonResponse ?? false;
    this._allowedHosts = options.allowedHosts;
    this._allowedOrigins = options.allowedOrigins;
    this._enableDnsRebindingProtection = options.enableDnsRebindingProtection ?? false;
  }

  async start(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    for (const stream of this._streams.values()) {
      try {
        stream.controller.close();
      } catch {
        // ignore
      }
    }
    this._streams.clear();
    this._requestToStream.clear();
    this._pendingJsonResponses.clear();
    this._standaloneStream = undefined;
    this.onclose?.();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    let requestId = options?.relatedRequestId;
    if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
      requestId = message.id;
    }

    if (requestId === undefined) {
      if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
        throw new Error("Cannot send a response without a related request.");
      }
      if (this._standaloneStream) {
        this.writeSseEvent(this._standaloneStream.controller, message);
      }
      return;
    }

    if (this._enableJsonResponse) {
      const pending = this._pendingJsonResponses.get(requestId);
      if (pending) {
        pending.resolve(message);
        this._pendingJsonResponses.delete(requestId);
      }
      return;
    }

    const streamId = this._requestToStream.get(requestId);
    const stream = streamId ? this._streams.get(streamId) : undefined;
    if (!stream) {
      throw new Error(`No connection established for request ID: ${String(requestId)}`);
    }

    this.writeSseEvent(stream.controller, message);

    if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
      stream.pendingIds.delete(requestId);
      this._requestToStream.delete(requestId);
      if (stream.pendingIds.size === 0) {
        this._streams.delete(stream.id);
        try {
          stream.controller.close();
        } catch {
          // ignore
        }
      }
    }
  }

  async handleRequest(request: Request, authInfo?: AuthInfo): Promise<Response> {
    const validationError = this.validateRequestHeaders(request.headers);
    if (validationError) {
      return this.jsonRpcError(400, -32000, validationError);
    }

    switch (request.method.toUpperCase()) {
      case "GET":
        return this.handleGetRequest();
      case "POST":
        return this.handlePostRequest(request, authInfo);
      case "DELETE":
        return this.handleDeleteRequest(request);
      default:
        return this.handleUnsupportedRequest();
    }
  }

  private validateRequestHeaders(headers: Headers): string | undefined {
    if (!this._enableDnsRebindingProtection) {
      return undefined;
    }
    if (this._allowedHosts && this._allowedHosts.length > 0) {
      const host = headers.get("host");
      if (!host || !this._allowedHosts.includes(host)) {
        return "Bad Request: Invalid Host header";
      }
    }
    if (this._allowedOrigins && this._allowedOrigins.length > 0) {
      const origin = headers.get("origin");
      if (origin && !this._allowedOrigins.includes(origin)) {
        return "Bad Request: Invalid Origin header";
      }
    }
    return undefined;
  }

  private validateProtocolVersion(headers: Headers): string | undefined {
    const version = headers.get("mcp-protocol-version") ?? DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      return `Bad Request: Unsupported protocol version (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`;
    }
    return undefined;
  }

  private async handleGetRequest(): Promise<Response> {
    if (this._standaloneStream) {
      return this.jsonRpcError(409, -32000, "Conflict: Only one SSE stream is allowed.");
    }

    const streamId = crypto.randomUUID();
    const pendingIds = new Set<RequestId>();
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
      },
      cancel: () => {
        this._standaloneStream = undefined;
      },
    });

    if (!controllerRef) {
      return this.jsonRpcError(500, -32000, "Failed to initialize SSE stream.");
    }

    this._standaloneStream = { id: streamId, controller: controllerRef, pendingIds };

    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    };
    if (this.sessionId !== undefined) {
      headers["mcp-session-id"] = this.sessionId;
    }
    return new Response(stream, { status: 200, headers });
  }

  private async handlePostRequest(request: Request, authInfo?: AuthInfo): Promise<Response> {
    const acceptHeader = request.headers.get("accept") ?? "";
    if (!acceptHeader.includes("application/json") || !acceptHeader.includes("text/event-stream")) {
      return this.jsonRpcError(406, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream");
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return this.jsonRpcError(415, -32000, "Unsupported Media Type: Content-Type must be application/json");
    }

    let rawMessage: unknown;
    try {
      rawMessage = await request.json();
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      return this.jsonRpcError(400, -32700, "Parse error");
    }

    let messages: JSONRPCMessage[];
    try {
      if (Array.isArray(rawMessage)) {
        messages = rawMessage.map((msg) => JSONRPCMessageSchema.parse(msg));
      } else {
        messages = [JSONRPCMessageSchema.parse(rawMessage)];
      }
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      return this.jsonRpcError(400, -32700, "Parse error");
    }

    const isInitializationRequest = messages.some(isInitializeRequest);
    if (isInitializationRequest) {
      if (this._initialized && this.sessionId !== undefined) {
        return this.jsonRpcError(400, -32600, "Invalid Request: Server already initialized");
      }
      if (messages.length > 1) {
        return this.jsonRpcError(400, -32600, "Invalid Request: Only one initialization request is allowed");
      }
      this.sessionId = this.sessionIdGenerator?.();
      this._initialized = true;
    } else {
      if (this.sessionIdGenerator !== undefined) {
        const sessionIdHeader = request.headers.get("mcp-session-id");
        if (!sessionIdHeader) {
          return this.jsonRpcError(400, -32000, "Bad Request: Missing Mcp-Session-Id header");
        }
        if (sessionIdHeader !== this.sessionId) {
          return this.jsonRpcError(404, -32001, "Session not found");
        }
      }
      const protocolError = this.validateProtocolVersion(request.headers);
      if (protocolError) {
        return this.jsonRpcError(400, -32000, protocolError);
      }
    }

    const requestInfo = { headers: Object.fromEntries(request.headers.entries()) };
    const extra: MessageExtraInfo = { authInfo, requestInfo };

    const hasRequests = messages.some(isJSONRPCRequest);
    if (!hasRequests) {
      for (const message of messages) {
        this.onmessage?.(message, extra);
      }
      return new Response(null, { status: 202 });
    }

    if (this._enableJsonResponse) {
      const responses = await this.collectJsonResponses(messages, extra);
      return this.jsonResponse(responses);
    }

    return this.createSseResponse(messages, extra);
  }

  private async handleDeleteRequest(request: Request): Promise<Response> {
    if (this.sessionIdGenerator !== undefined) {
      const sessionIdHeader = request.headers.get("mcp-session-id");
      if (!sessionIdHeader) {
        return this.jsonRpcError(400, -32000, "Bad Request: Missing Mcp-Session-Id header");
      }
      if (sessionIdHeader !== this.sessionId) {
        return this.jsonRpcError(404, -32001, "Session not found");
      }
      this.sessionId = undefined;
      this._initialized = false;
      return new Response(null, { status: 204 });
    }
    return this.jsonRpcError(405, -32000, "Method not allowed.");
  }

  private handleUnsupportedRequest(): Response {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      }),
      { status: 405, headers: { Allow: "GET, POST, DELETE" } }
    );
  }

  private async collectJsonResponses(messages: JSONRPCMessage[], extra: MessageExtraInfo): Promise<JSONRPCMessage[] | JSONRPCMessage> {
    const requestIds = messages.filter(isJSONRPCRequest).map((message) => message.id);
    const responsePromises = requestIds.map(
      (id) =>
        new Promise<JSONRPCMessage>((resolve, reject) => {
          this._pendingJsonResponses.set(id, { resolve, reject });
        })
    );

    for (const message of messages) {
      this.onmessage?.(message, extra);
    }

    const responses = await Promise.all(responsePromises);
    return responses.length === 1 ? responses[0] : responses;
  }

  private createSseResponse(messages: JSONRPCMessage[], extra: MessageExtraInfo): Response {
    const streamId = crypto.randomUUID();
    const pendingIds = new Set<RequestId>();
    for (const message of messages) {
      if (isJSONRPCRequest(message)) {
        pendingIds.add(message.id);
        this._requestToStream.set(message.id, streamId);
      }
    }

    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
      },
      cancel: () => {
        this._streams.delete(streamId);
        for (const id of pendingIds) {
          this._requestToStream.delete(id);
        }
      },
    });

    if (!controllerRef) {
      return this.jsonRpcError(500, -32000, "Failed to initialize SSE stream.");
    }

    this._streams.set(streamId, { id: streamId, controller: controllerRef, pendingIds });

    for (const message of messages) {
      this.onmessage?.(message, extra);
    }

    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    };
    if (this.sessionId !== undefined) {
      headers["mcp-session-id"] = this.sessionId;
    }
    return new Response(stream, { status: 200, headers });
  }

  private writeSseEvent(controller: ReadableStreamDefaultController<Uint8Array>, message: JSONRPCMessage): void {
    const payload = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    controller.enqueue(ENCODER.encode(payload));
  }

  private jsonResponse(body: JSONRPCMessage[] | JSONRPCMessage): Response {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.sessionId !== undefined) {
      headers["mcp-session-id"] = this.sessionId;
    }
    return new Response(JSON.stringify(body), { status: 200, headers });
  }

  private jsonRpcError(status: number, code: number, message: string): Response {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code, message },
        id: null,
      }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}

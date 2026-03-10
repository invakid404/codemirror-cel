import { Transport } from "@open-rpc/client-js/build/transports/Transport";
import { getNotifications } from "@open-rpc/client-js/build/Request";
import type { JSONRPCRequestData } from "@open-rpc/client-js/build/Request";

/**
 * A custom Transport for @open-rpc/client-js that communicates with
 * a Web Worker via postMessage. The worker runs a JSON-RPC server
 * (e.g. an LSP server compiled to WASM).
 *
 * Requests are serialized as JSON and sent via `worker.postMessage()`.
 * Responses and server-initiated notifications arrive as `message`
 * events on the worker.
 */
export class WorkerTransport extends Transport {
  private worker: Worker;

  constructor(worker: Worker) {
    super();
    this.worker = worker;
  }

  /**
   * Set up the message listener on the worker so that incoming
   * JSON-RPC responses and notifications are forwarded to the
   * transport's request manager for resolution.
   */
  async connect(): Promise<void> {
    this.worker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data;
      // resolveResponse expects a JSON string payload.
      // The worker sends structured objects, so we serialize them.
      this.transportRequestManager.resolveResponse(
        typeof data === "string" ? data : JSON.stringify(data),
      );
    });
  }

  /**
   * Serialize the JSON-RPC request and send it to the worker.
   * Notifications (requests without an id) are settled immediately
   * since no response is expected.
   */
  async sendData(
    data: JSONRPCRequestData,
    timeout?: number | null,
  ): Promise<any> {
    const prom = this.transportRequestManager.addRequest(data, timeout ?? null);
    const notifications = getNotifications(data);

    // parseData() extracts the raw JSON-RPC request object(s) from the
    // internal wrapper. We send the parsed form so the worker receives
    // a clean JSON-RPC message.
    const parsed = this.parseData(data);
    this.worker.postMessage(parsed);

    // Settle any notification requests immediately — they don't get responses.
    this.transportRequestManager.settlePendingRequest(notifications);

    return prom;
  }

  /**
   * Terminate the worker and clean up.
   */
  close(): void {
    this.worker.terminate();
  }
}

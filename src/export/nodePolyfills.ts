type FileReaderHandler = ((ev: { target: { result: ArrayBuffer | string | null } }) => void) | null;

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onload: FileReaderHandler = null;
  onloadend: FileReaderHandler = null;
  onerror: ((err: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => this.dispatch(buf))
      .catch((err) => this.fail(err));
  }

  readAsDataURL(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => {
        const b64 = Buffer.from(buf).toString("base64");
        this.dispatch(`data:${blob.type};base64,${b64}`);
      })
      .catch((err) => this.fail(err));
  }

  private dispatch(result: ArrayBuffer | string): void {
    this.result = result;
    const ev = { target: { result } };
    this.onload?.(ev);
    this.onloadend?.(ev);
  }

  private fail(err: unknown): void {
    this.onerror?.(err);
  }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.FileReader === "undefined") {
  g.FileReader = NodeFileReader;
}

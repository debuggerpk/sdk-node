import { AbortController } from 'abort-controller';
import { ActivityFunction } from '@temporalio/workflow';
import { DataConverter } from '@temporalio/workflow/lib/converter/data-converter';
import { coresdk } from '@temporalio/proto';
import { asyncLocalStorage } from '@temporalio/activity';
import { Context, CancellationError, Info } from '@temporalio/activity';

export class Activity {
  protected cancelRequested = false;
  public readonly context: Context;
  public cancel: (reason?: any) => void = () => undefined;
  public readonly abortController: AbortController = new AbortController();

  // TODO: get all of the atributes required for setting the ActivityContext
  constructor(
    public readonly info: Info,
    protected readonly fn: ActivityFunction<any[], any>,
    protected readonly args: any[],
    public readonly dataConverter: DataConverter,
    public readonly heartbeatCallback: Context['heartbeat']
  ) {
    const promise = new Promise<never>((_, reject) => {
      this.cancel = (reason?: any) => {
        this.cancelRequested = true;
        this.abortController.abort();
        reject(new CancellationError(reason));
      };
    });
    this.context = new Context(info, promise, this.abortController.signal, this.heartbeatCallback);
    promise.catch(() => undefined);
  }

  public run(): Promise<coresdk.activity_result.IActivityResult> {
    return asyncLocalStorage.run(this.context, async (): Promise<coresdk.activity_result.IActivityResult> => {
      try {
        const result = await this.fn(...this.args);
        if (this.cancelRequested) {
          return { canceled: {} };
        }
        return { completed: { result: this.dataConverter.toPayload(result) } };
      } catch (err) {
        if (this.cancelRequested) {
          return { canceled: {} };
        }
        return { failed: { failure: err?.message ? { message: err.message } : undefined } };
      }
    });
  }
}

import { DiagnosticsErrorHandler } from './diagnostics-error-handler';

describe('DiagnosticsErrorHandler', () => {

  function setup() {
    const calls: Array<[string, string, unknown]> = [];
    const diagnostics = { log: (cat: string, msg: string, data?: unknown) => calls.push([cat, msg, typeof data === 'function' ? (data as () => unknown)() : data]) };
    const consoleError = spyOn(console, 'error');
    return { handler: new DiagnosticsErrorHandler(diagnostics as never), calls, consoleError };
  }

  it('puts the error in the log under "error"', () => {
    const { handler, calls } = setup();
    const failure = new TypeError('x is undefined');

    handler.handleError(failure);

    expect(calls).toEqual([['error', 'ErrorHandler', { error: failure }]]);
  });

  it('still does what Angular\'s handler does: the error reaches the console', () => {
    const { handler, consoleError } = setup();
    const failure = new Error('boom');

    handler.handleError(failure);

    expect(consoleError).toHaveBeenCalledWith('ERROR', failure);
  });

  it('logs before it hands over, so a handler that dies still leaves the entry', () => {
    const { handler, calls, consoleError } = setup();
    consoleError.and.throwError('console is gone');

    expect(() => handler.handleError(new Error('boom'))).toThrowError('console is gone');
    expect(calls.length).toBe(1);
  });
});

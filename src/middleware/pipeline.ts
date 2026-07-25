/**
 * Middleware type definition.
 * Each middleware receives a context of type T and a next function to advance execution.
 */
export type Middleware<T> = (context: T, next: () => Promise<void>) => Promise<void>;

/**
 * Pipeline execution engine.
 * Chains middleware functions sequentially, ensuring extensible rules can be plugged in
 * without modifying the core gateway event handlers.
 */
export class Pipeline<T> {
  private middlewares: Middleware<T>[] = [];

  /**
   * Registers a new middleware function in the execution queue.
   */
  use(middleware: Middleware<T>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Executes the registered middleware queue sequentially.
   * Uses an asynchronous dispatch structure (onion execution model).
   */
  async execute(context: T): Promise<void> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        return Promise.reject(new Error('next() called multiple times in a single middleware.'));
      }
      index = i;
      const middleware = this.middlewares[i];
      
      if (middleware) {
        await middleware(context, () => dispatch(i + 1));
      }
    };

    await dispatch(0);
  }
}
export default Pipeline;

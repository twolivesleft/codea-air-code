export type Result<T, E extends Error> = {
    success: true;
    value: T;
} | {
    success: false;
    error: E;
};

export namespace Result {
    export function success<T>(value: T): Result<T, never> {
        return { success: true, value };
    }

    export function error<E extends Error>(error: E): Result<never, E> {
        return { success: false, error };
    }

    export function from<T, E extends Error>(result: T | E): Result<T, E> {
        if (result instanceof Error) {
            return error(result);
        } else {
            return success(result);
        }
    }
}
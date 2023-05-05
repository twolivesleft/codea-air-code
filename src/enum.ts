export namespace Enum {
    export function fromRawValue<T extends Record<string, string>>(enumType: T, value: string): keyof T | null {
        if (Object.values(enumType).includes(value)) {
            return value as keyof T;
        } else {
            return null;
        }
    }
}
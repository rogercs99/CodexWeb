type ObjectHasOwnFn = (target: object, prop: PropertyKey) => boolean;

if (typeof Object.hasOwn !== 'function') {
  (Object as ObjectConstructor & { hasOwn: ObjectHasOwnFn }).hasOwn = function hasOwn(
    target: object,
    prop: PropertyKey
  ): boolean {
    if (target === null || target === undefined) return false;
    return Object.prototype.hasOwnProperty.call(Object(target), prop);
  };
}

export {};

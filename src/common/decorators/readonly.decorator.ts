export const READONLY_METADATA_KEY = 'custom:readonly';

export function ReadOnly(): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    Reflect.defineMetadata(READONLY_METADATA_KEY, true, target, propertyKey);
  };
}


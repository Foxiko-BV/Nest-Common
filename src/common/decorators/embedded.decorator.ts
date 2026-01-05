import { Type } from '@nestjs/common';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type as TypeDecorator } from 'class-transformer';

const EMBEDDED_METADATA_KEY = 'custom:embedded_properties';
const EMBEDDED_CLASS_KEY = 'custom:embedded_class';

export function Embedded(typeFunc?: () => Type<any>): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // 1. Setup metadata for runtime getter
    const properties = Reflect.getMetadata(EMBEDDED_METADATA_KEY, target) || [];
    if (!properties.includes(propertyKey)) {
      properties.push(propertyKey);
      Reflect.defineMetadata(EMBEDDED_METADATA_KEY, properties, target);
    }

    // 2. Hide original property
    Exclude()(target, propertyKey);
    ApiHideProperty()(target, propertyKey);

    // 3. Setup _embedded class for Swagger and Serialization
    const targetConstructor = target.constructor;
    let EmbeddedClass = Reflect.getMetadata(EMBEDDED_CLASS_KEY, targetConstructor);

    if (!EmbeddedClass) {
      // Create a dynamic class to represent the _embedded object structure
      EmbeddedClass = class {};
      // Name it uniquely so Swagger and ClassTransformer don't merge schemas incorrectly
      Object.defineProperty(EmbeddedClass, 'name', { value: `${targetConstructor.name}Embedded` });
      Reflect.defineMetadata(EMBEDDED_CLASS_KEY, EmbeddedClass, targetConstructor);

      // Define _embedded on the original entity
      Object.defineProperty(target, '_embedded', {
        get: function () {
          const embeddedProps: string[] = Reflect.getMetadata(EMBEDDED_METADATA_KEY, target) || [];
          const result: any = {};
          let hasValues = false;
          
          for (const prop of embeddedProps) {
            if (this[prop] !== undefined && this[prop] !== null) {
              result[prop] = this[prop];
              hasValues = true;
            }
          }
          
          return hasValues ? result : undefined;
        },
        enumerable: true,
        configurable: true,
      });

      // Expose _embedded and document it
      Expose()(target, '_embedded');
      ApiProperty({ type: EmbeddedClass, readOnly: true, required: true })(target, '_embedded');
      // Ensure class-transformer transforms the plain object returned by getter into EmbeddedClass instance
      TypeDecorator(() => EmbeddedClass)(target, '_embedded');
    }

    // 4. Add property to the EmbeddedClass schema
    const designType = Reflect.getMetadata('design:type', target, propertyKey);
    const isArray = designType === Array;
    
    const resolvedType = typeFunc ? typeFunc() : designType;

    // Define the property on the prototype of EmbeddedClass
    Object.defineProperty(EmbeddedClass.prototype, propertyKey, {
      value: undefined,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    // Mark as exposed so class-transformer includes it (strategy: excludeAll is common)
    Expose()(EmbeddedClass.prototype, propertyKey);

    // Apply ApiProperty to the field in the dynamic class
    if (isArray && resolvedType) {
      ApiProperty({ type: resolvedType, isArray: true })(EmbeddedClass.prototype, propertyKey);
      // Also apply Type decorator for recursive transformation
      TypeDecorator(() => resolvedType)(EmbeddedClass.prototype, propertyKey);
    } else if (resolvedType) {
        ApiProperty({ type: resolvedType })(EmbeddedClass.prototype, propertyKey);
        TypeDecorator(() => resolvedType)(EmbeddedClass.prototype, propertyKey);
    } else {
        ApiProperty()(EmbeddedClass.prototype, propertyKey);
    }
  };
}

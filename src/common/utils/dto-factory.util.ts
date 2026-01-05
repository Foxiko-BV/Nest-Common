import { Type } from '@nestjs/common';
import { MetadataStorage, AnyEntity, EntityProperty } from '@mikro-orm/core';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsBoolean, IsDate, IsArray, IsEnum, IsInt, IsNotEmpty, getMetadataStorage, ValidationOptions } from 'class-validator';
import { Type as TypeTransformer } from 'class-transformer';
import { CrudOptions } from '../interfaces/crud-options.interface';
import { READONLY_METADATA_KEY } from '../decorators/readonly.decorator';

export class DtoFactory {
    static createDtos<T extends AnyEntity, C, U>(options: CrudOptions<T, C, U>) {
        const { defaultMetadataStorage } = require('class-transformer/cjs/storage');

        if (!options.createDto || !options.updateDto) {
            const meta = MetadataStorage.getMetadataFromDecorator(options.entity);
            const target = options.entity;

            const excluded = new Set<string>();

            // Class Transformer Logic
            let transformerStrategy = 'excludeAll';
            const exposedTransformerProps = new Set<string>();
            const excludedTransformerProps = new Set<string>();

            let currentTarget = target;
            while (currentTarget) {
                // Class Transformer - Strategy & Metadata
                const strategy = defaultMetadataStorage.getStrategy(currentTarget);
                if (strategy && strategy !== 'none') {
                    transformerStrategy = strategy;
                }

                const exposed = defaultMetadataStorage.getExposedMetadatas(currentTarget);
                exposed.forEach((m: any) => {
                    if (!m.options?.toPlainOnly) {
                        exposedTransformerProps.add(m.propertyName);
                    }
                });

                const excludedMeta = defaultMetadataStorage.getExcludedMetadatas(currentTarget);
                excludedMeta.forEach((m: any) => {
                    if (!m.options?.toPlainOnly) {
                        excludedTransformerProps.add(m.propertyName);
                    }
                });

                const swaggerProps = Reflect.getMetadata('swagger/apiModelPropertiesArray', currentTarget.prototype) || [];
                swaggerProps.forEach((prop: string) => {
                    const propertyKey = prop.startsWith(':') ? prop.substring(1) : prop;
                    const meta = Reflect.getMetadata('swagger/apiModelProperties', currentTarget.prototype, propertyKey);
                    if (meta && meta.readOnly) {
                        excluded.add(propertyKey);
                    }

                    // Check if property is marked as readonly in TypeScript class definition
                    const descriptor = Object.getOwnPropertyDescriptor(currentTarget.prototype, propertyKey);
                    if (descriptor && !descriptor.writable) {
                        excluded.add(propertyKey);
                    }
                });

                // Exclude getters and non-writable properties from the prototype
                const propertyNames = Object.getOwnPropertyNames(currentTarget.prototype);
                propertyNames.forEach(prop => {
                    const descriptor = Object.getOwnPropertyDescriptor(currentTarget.prototype, prop);
                    if (descriptor && (descriptor.get || !descriptor.writable)) {
                        excluded.add(prop);
                    }

                    // Exclude properties marked with @ReadOnly()
                    if (Reflect.getMetadata(READONLY_METADATA_KEY, currentTarget.prototype, prop)) {
                        excluded.add(prop);
                    }
                });

                currentTarget = Object.getPrototypeOf(currentTarget);
                if (currentTarget === Object.prototype || currentTarget === Function.prototype) break;
            }

            // MikroORM Metadata
            if (meta) {
                Object.values(meta.properties).forEach((prop: EntityProperty) => {
                    if (prop.primary) excluded.add(prop.name);
                    // prop.persist === false checks for virtual
                    if (prop.persist === false) excluded.add(prop.name);
                    // auto-generated fields
                    if (prop.autoincrement) excluded.add(prop.name);
                    if (prop.onCreate) excluded.add(prop.name);
                    if (prop.onUpdate) excluded.add(prop.name);
                    if (prop.version) excluded.add(prop.name);

                    if (Reflect.getMetadata(READONLY_METADATA_KEY, target.prototype, prop.name)) {
                        excluded.add(prop.name);
                    }

                    // Class Transformer Exclusion
                    if (transformerStrategy === 'excludeAll') {
                        if (!exposedTransformerProps.has(prop.name)) {
                            excluded.add(prop.name);
                        }
                    } else {
                        if (excludedTransformerProps.has(prop.name)) {
                            excluded.add(prop.name);
                        }
                    }
                });
            }

            if (!options.createDto) {
                class DefaultCreateDto  { }
                Object.defineProperty(DefaultCreateDto, 'name', { value: `${options.entity.name}CreateDto` });

                if (meta) {
                    Object.values(meta.properties).forEach((prop: EntityProperty) => {
                        if (excluded.has(prop.name)) return;
                        let designType = Reflect.getMetadata('design:type', options.entity.prototype, prop.name);
                        let isArray = designType === Array || !!prop.array;

                        const typeMeta = defaultMetadataStorage.findTypeMetadata(options.entity, prop.name);
                        if (typeMeta && typeMeta.typeFunction) {
                            const innerType = typeMeta.typeFunction();
                            if (innerType) {
                                designType = innerType;
                            }
                        }
                        const props: ValidationOptions = {}
                        if (isArray) props.each = isArray;

                        // Validation decorators based on type
                        // We check prop.type but it might be string. We use designType if available.
                        // Or infer from prop.type

                        let typeToCheck = designType;
                        if (isArray && typeToCheck === Array) {
                            typeToCheck = undefined;
                        }

                        if (!typeToCheck && prop.type) {
                            if (prop.type === 'string') typeToCheck = String;
                            if (prop.type === 'number') typeToCheck = Number;
                            if (prop.type === 'boolean') typeToCheck = Boolean;
                            if (prop.type === 'Date') typeToCheck = Date;
                        }

                        if (typeToCheck === String) {
                            IsString(props)(DefaultCreateDto.prototype, prop.name);
                        } else if (typeToCheck === Number) {
                            // integer check
                            const isInt = ['integer', 'int', 'smallint', 'tinyint', 'mediumint', 'bigint'].includes(prop.columnTypes?.[0] as string) || (prop.type === 'number' && (prop as any).integer);
                            if (isInt) {
                                IsInt(props)(DefaultCreateDto.prototype, prop.name);
                            } else {
                                IsNumber(undefined, props)(DefaultCreateDto.prototype, prop.name);
                            }
                        } else if (typeToCheck === Boolean) {
                            IsBoolean(props)(DefaultCreateDto.prototype, prop.name);
                        } else if (typeToCheck === Date) {
                            IsDate(props)(DefaultCreateDto.prototype, prop.name);
                            TypeTransformer(() => Date)(DefaultCreateDto.prototype, prop.name);
                        }

                        if (prop.enum) {
                            // prop.items might have enum values
                            if (prop.items) {
                                let items = prop.items;
                                if (typeof items === 'function') {
                                    items = (items as any)();
                                }
                                IsEnum(items, props)(DefaultCreateDto.prototype, prop.name);
                            }
                        }

                        if (prop.array || isArray) {
                            IsArray({ ...props, each: undefined })(DefaultCreateDto.prototype, prop.name);
                        }

                        if (prop.nullable) {
                            IsOptional(props)(DefaultCreateDto.prototype, prop.name);
                            const apiOptions: any = { type: typeToCheck, isArray };
                            if (prop.enum && prop.items) {
                                let items = prop.items;
                                if (typeof items === 'function') {
                                    items = (items as any)();
                                }
                                apiOptions.enum = items;
                                if (typeof prop.type === 'string' && !['string', 'number', 'boolean', 'date', 'array', 'object'].includes(prop.type.toLowerCase())) {
                                    apiOptions.enumName = prop.type;
                                }
                            }
                            ApiPropertyOptional(apiOptions)(DefaultCreateDto.prototype, prop.name);
                        } else {
                            IsNotEmpty(props)(DefaultCreateDto.prototype, prop.name);
                            const apiOptions: any = { type: typeToCheck, isArray };
                            if (prop.enum && prop.items) {
                                let items = prop.items;
                                if (typeof items === 'function') {
                                    items = (items as any)();
                                }
                                apiOptions.enum = items;
                                if (typeof prop.type === 'string' && !['string', 'number', 'boolean', 'date', 'array', 'object'].includes(prop.type.toLowerCase())) {
                                    apiOptions.enumName = prop.type;
                                }
                            }
                            ApiProperty(apiOptions)(DefaultCreateDto.prototype, prop.name);
                        }
                    });
                }
                options.createDto = DefaultCreateDto as unknown as Type<C>;
            }

            if (!options.updateDto) {
                class DefaultUpdateDto extends PartialType(options.createDto as any) { }
                Object.defineProperty(DefaultUpdateDto, 'name', { value: `${options.entity.name}UpdateDto` });

                const storage = getMetadataStorage();
                const { ValidationMetadata } = require('class-validator/cjs/metadata/ValidationMetadata');
                const targetMetadatas = storage.getTargetValidationMetadatas(options.createDto, '', false, false);

                targetMetadatas.forEach(meta => {
                    if (meta.propertyName) {
                        const newMeta = new ValidationMetadata({
                            ...meta,
                            target: DefaultUpdateDto,
                        });
                        storage.addValidationMetadata(newMeta);
                        IsOptional()(DefaultUpdateDto.prototype, meta.propertyName);
                    }
                });

                options.updateDto = DefaultUpdateDto as unknown as Type<U>;
            }
        }
    }
}

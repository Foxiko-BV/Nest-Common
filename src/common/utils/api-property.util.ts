import { ApiParam, ApiProperty, ApiPropertyOptions } from "@nestjs/swagger";
import { ClassConstructor, Transform } from "class-transformer";
import { ObjectId } from "mongodb";
import { MetadataStorage } from "@mikro-orm/core";

export class ApiPropertyUtil {
    static processApiParams(target: any) {
        // Class Level Params
        const path = Reflect.getMetadata('path', target);
        const params: string[] = [];
        if (path) {
            const pathStr = Array.isArray(path) ? path[0] : path;
            if (typeof pathStr === 'string') {
                const regex = /:([^\/]+)/g;
                let match;
                while ((match = regex.exec(pathStr)) !== null) {
                    params.push(match[1]);
                }
            }
        }

        for (const param of params) {
            ApiParam({ name: param, type: 'string' })(target);
        }

        // Method Level Params
        const methods = Object.getOwnPropertyNames(target.prototype).filter(m => m !== 'constructor');
        for (const method of methods) {
            const descriptor = Object.getOwnPropertyDescriptor(target.prototype, method);
            if (!descriptor) continue;

            const methodPath = Reflect.getMetadata('path', descriptor.value);
            if (methodPath) {
                const pathStr = Array.isArray(methodPath) ? methodPath[0] : methodPath;
                if (typeof pathStr === 'string') {
                    const regex = /:([^\/]+)/g;
                    let match;
                    while ((match = regex.exec(pathStr)) !== null) {
                        const param = match[1];
                        ApiParam({ name: param, type: 'string' })(target.prototype, method, descriptor);
                        Object.defineProperty(target.prototype, method, descriptor);
                    }
                }
            }
        }
    }

    static createApiEntity<X, T extends ClassConstructor<X>>(entity: T, visited = new Set<any>()) {
        if (!entity || visited.has(entity)) {
            return;
        }
        visited.add(entity);

        const { defaultMetadataStorage } = require('class-transformer/cjs/storage');
        const ormMeta = MetadataStorage.getMetadataFromDecorator(entity);

        const exposedMetadatas = defaultMetadataStorage.getExposedMetadatas(entity);
        if (!exposedMetadatas?.length) {
            return;
        }

        exposedMetadatas
            .forEach((metadata: any) => {
                const propertyName = metadata.propertyName;
                if (!propertyName) return;

                let type = Reflect.getMetadata('design:type', entity.prototype, propertyName);
                const prop = ormMeta?.properties?.[propertyName];

                let isArray = type === Array || !!prop?.array;
                let itemType = type;

                if (itemType === Array && prop?.type) {
                    if (prop.type === 'string') itemType = String;
                    else if (prop.type === 'number') itemType = Number;
                    else if (prop.type === 'boolean') itemType = Boolean;
                    else if (prop.type === 'Date') itemType = Date;
                }

                const typeMeta = defaultMetadataStorage.findTypeMetadata(entity, propertyName);
                if (typeMeta && typeMeta.typeFunction) {
                    const innerType = typeMeta.typeFunction();
                    if (innerType) {
                        itemType = innerType;
                    }
                }

                if (
                    itemType &&
                    typeof itemType === 'function' &&
                    itemType !== String &&
                    itemType !== Number &&
                    itemType !== Boolean &&
                    itemType !== Date &&
                    itemType !== ObjectId &&
                    itemType !== Array
                ) {
                    this.createApiEntity(itemType, visited);
                }

                if (!Reflect.hasMetadata('swagger/apiModelProperties', entity.prototype, propertyName)) {
                    let required = true;

                    if (prop && (prop.nullable || prop.optional)) {
                        required = false;
                    }

                    if (itemType === ObjectId) {
                        if (isArray) {
                            Transform(({ value }: { value: any[] }) => value?.map(v => v?.toString()))(entity.prototype, propertyName);
                            ApiProperty({ type: () => String, isArray: true, required })(entity.prototype, metadata.options.name ?? propertyName);
                        } else {
                            Transform(({ value }: { value: any }) => value?.toString())(entity.prototype, propertyName);
                            ApiProperty({ type: () => String, required })(entity.prototype, metadata.options.name ?? propertyName);
                        }
                    } else {
                        const options: ApiPropertyOptions = {
                            type: () => itemType,
                            required: required,
                        };

                        if (prop?.enum) {
                            options.enum = prop.items;
                            if (typeof prop.type === 'string') {
                                (options as any).enumName = prop.type;
                            }
                        }

                        if (isArray) {
                            options.isArray = true;
                        }
                        ApiProperty(options)(entity.prototype, metadata.options.name ?? propertyName);
                    }
                }
            });

    }
}

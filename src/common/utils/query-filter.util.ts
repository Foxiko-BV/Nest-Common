import { Type } from '@nestjs/common';
import { MetadataStorage, FilterQuery } from '@mikro-orm/core';
import { ApiQueryOptions } from '@nestjs/swagger';

export class QueryFilterUtil {
  
  private static getExposedNameMap<T>(entity: Type<T>): { toExposed: Map<string, string>, toInternal: Map<string, string> } {
    const { defaultMetadataStorage } = require('class-transformer/cjs/storage');
    
    const toExposed = new Map<string, string>();
    const toInternal = new Map<string, string>();
    
    const exposedMetadatas = defaultMetadataStorage.getExposedMetadatas(entity);

    if (exposedMetadatas) {
      exposedMetadatas.forEach((m: any) => {
        if (m.propertyName) {
            const exposedName = m.options?.name || m.propertyName;
            toExposed.set(m.propertyName, exposedName);
            toInternal.set(exposedName, m.propertyName);
        }
      });
    }
    
    return { toExposed, toInternal };
  }

  static getSwaggerQueryParams<T>(
    entity: Type<T>,
    filterConfig: { [key: string]: boolean | ((value: any) => FilterQuery<T>) },
  ): ApiQueryOptions[] {
    const meta = MetadataStorage.getMetadataFromDecorator(entity);
    const params: ApiQueryOptions[] = [];

    if (!meta) return params;

    const { toExposed } = this.getExposedNameMap(entity);

    for (const [key, config] of Object.entries(filterConfig)) {
      if (!config) continue;

      const exposedName = toExposed.get(key) || key;

      if (typeof config === 'function') {
        params.push({
          name: exposedName,
          required: false,
          type: 'string',
        });
        continue;
      }

      const prop = meta.properties[key];
      if (!prop) continue;

      const type = prop.type;
      
      // Base exact match for all types
      params.push({
        name: exposedName,
        required: false,
        type: 'string', // Query params are strings, will be parsed
        description: `Filter by ${exposedName} (exact match)`,
      });

      if (type === 'string' || type === String) {
        params.push({
          name: `${exposedName}.contains`,
          required: false,
          type: 'string',
          description: `Filter by ${exposedName} (contains)`,
        });
      } else if (
        type === 'number' ||
        type === Number ||
        type === 'date' ||
        type === Date ||
        (typeof type === 'string' && type.toLowerCase().includes('date'))
      ) {
        params.push({
          name: `${exposedName}.min`,
          required: false,
          type: 'string', // Can be number or date string
          description: `Filter by ${exposedName} (minimum value)`,
        });
        params.push({
          name: `${exposedName}.max`,
          required: false,
          type: 'string',
          description: `Filter by ${exposedName} (maximum value)`,
        });
      }
    }

    return params;
  }

  static parseQueryFilters<T>(
    query: Record<string, any>,
    filterConfig: { [key: string]: boolean | ((value: any) => FilterQuery<T>) },
    entity: Type<T>,
  ): Record<string, any> {
    const meta = MetadataStorage.getMetadataFromDecorator(entity);
    const where: Record<string, any> = {};

    if (!meta) return where;

    const { toExposed } = this.getExposedNameMap(entity);

    for (const [key, config] of Object.entries(filterConfig)) {
      if (!config) continue;

      const exposedName = toExposed.get(key) || key;

      if (typeof config === 'function') {
        if (query[exposedName] !== undefined) {
          const customFilter = config(query[exposedName]);
          Object.assign(where, customFilter);
        }
        continue;
      }

      const prop = meta.properties[key];
      if (!prop) continue;

      const type = prop.type;
      const isString = type === 'string' || type === String;
      const isNumber = type === 'number' || type === Number;
      const isDate =
        type === 'date' ||
        type === Date ||
        (typeof type === 'string' && type.toLowerCase().includes('date'));
      const isBoolean = type === 'boolean' || type === Boolean;

      // Exact match
      if (query[exposedName] !== undefined) {
        if (isNumber) {
          where[key] = Number(query[exposedName]);
        } else if (isBoolean) {
          where[key] = query[exposedName] === 'true';
        } else if (isDate) {
           where[key] = new Date(query[exposedName]);
        } else {
          where[key] = query[exposedName];
        }
      }

      // String contains
      if (isString && query[`${exposedName}.contains`] !== undefined) {
        where[key] = { ...(where[key] || {}), $like: `%${query[`${exposedName}.contains`]}%` };
      }

      // Min/Max for Numbers and Dates
      if ((isNumber || isDate) && (query[`${exposedName}.min`] !== undefined || query[`${exposedName}.max`] !== undefined)) {
        const range: any = {};
        if (query[`${exposedName}.min`] !== undefined) {
          range.$gte = isNumber ? Number(query[`${exposedName}.min`]) : new Date(query[`${exposedName}.min`]);
        }
        if (query[`${exposedName}.max`] !== undefined) {
          range.$lte = isNumber ? Number(query[`${exposedName}.max`]) : new Date(query[`${exposedName}.max`]);
        }
        where[key] = { ...(where[key] || {}), ...range };
      }
    }

    return where;
  }
}

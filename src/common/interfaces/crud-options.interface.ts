import { Type } from '@nestjs/common';
import { EntityData, FilterQuery } from '@mikro-orm/core';
import { Request } from '@nestjs/common';

export interface CrudOptions<T, C = EntityData<T>, U = EntityData<T>> {
  tag?: string;
  primaryKey?: string;
  entity: Type<T>;
  createDto?: Type<C>;
  updateDto?: Type<U>;
  defaultValues?: (request: Request, params: Record<string, string>) => EntityData<T> | Promise<EntityData<T>>;
  operations?: {
    create?: {
    } | false,
    createMany?: {
    } | false,
    update?: {
    } | false,
    import?: {
    } | false,
    query?: {
      pagination?: boolean;
      sort?: {
        field: string;
        order: 'ASC' | 'DESC';
      }[];
    } | false,
    read?: {
    } | false,
    delete?: {
    } | false,
    replace?: {
    } | false,
    export?: {
    } | false,
  },
  persist?: (request: Request, params: Record<string, string>) => EntityData<T> | Promise<EntityData<T>>;
  filter?: (request: Request, params: Record<string, string>) => FilterQuery<T> | Promise<FilterQuery<T>>;
}

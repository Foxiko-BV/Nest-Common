export class CRUDEventUpdate<T> {
    constructor(public readonly entity: T) {}
}

export class CRUDEventCreate<T> {
    constructor(public readonly entity: T) {}
}

export class CRUDEventDelete<T> {
    constructor(public readonly entity: T) {}
}

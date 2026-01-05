/**
 * Utility to convert entity class names or routes to human-readable names
 */
export class EntityNameUtil {
  /**
   * Convert a route name (e.g., 'sales-invoices') to a human-readable name (e.g., 'sales invoice')
   */
  static routeToName(route: string): string {
    return route.replace(/-/g, ' ').replace(/s$/, '').trim();
  }

  /**
   * Convert an entity class name (e.g., 'SalesInvoice') to a human-readable name (e.g., 'sales invoice')
   */
  static classToName(entityClass: any): string {
    if (!entityClass || !entityClass.name) {
      return 'item';
    }
    
    // Convert PascalCase to space-separated lowercase
    // e.g., "SalesInvoice" -> "sales invoice"
    const name = entityClass.name
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
    
    // Remove "entity" suffix if present
    return name.replace(/\s+entity$/, '').trim();
  }

  /**
   * Convert an entity class name (e.g., 'SalesInvoiceItem') to a kebab-case string (e.g., 'sales-invoice-item')
   */
  static classToSlug(entityClass: any): string {
    if(!entityClass) throw new Error('Entity class is required');
    if(typeof entityClass !== 'string') {
      entityClass = entityClass.name;
    }

    return entityClass
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
  }

  /**
   * Get a human-readable name from either a route or entity class
   */
  static getName(route?: string, entityClass?: any): string {
    if (route) {
      return this.routeToName(route);
    }
    if (entityClass) {
      return this.classToName(entityClass);
    }
    return 'item';
  }

  /**
   * Get plural form of a name (e.g., 'sales invoice' -> 'sales invoices')
   */
  static pluralize(name: string): string {
    if (name.endsWith('y')) {
      return name.slice(0, -1) + 'ies';
    }
    if (name.endsWith('s') || name.endsWith('x') || name.endsWith('z') || name.endsWith('ch') || name.endsWith('sh')) {
      return name + 'es';
    }
    return name + 's';
  }

  /**
   * Capitalize first letter of each word (e.g., 'sales invoice' -> 'Sales Invoice')
   */
  static capitalize(name: string): string {
    return name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }
}


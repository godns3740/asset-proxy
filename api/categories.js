import { crudHandler } from './_crud.js';
export default crudHandler('categories', { order: 'type.asc,name.asc' });

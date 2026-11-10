import { crudHandler } from './_crud.js';
export default crudHandler('transactions', {
  order: 'date.desc',
  extraFilters: q => {
    if (q.start && q.end) return `&date=gte.${q.start}&date=lte.${q.end}`;
    if (q.month) return `&date=gte.${q.month}-01&date=lte.${q.month}-31`;
    return '';
  },
});

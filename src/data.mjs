export function normalizeBoard(value) {
  if (!value || !Array.isArray(value.columns) || !value.columns.every(column =>
    column && typeof column.name === 'string' && Array.isArray(column.tasks) &&
    column.tasks.every(task => task && typeof task.id === 'string' && typeof task.title === 'string')
  )) throw new Error('بيانات لوحة المهام غير متوافقة. حدّث هيرمز ثم أعد المحاولة.')
  return value
}

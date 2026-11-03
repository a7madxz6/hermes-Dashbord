export function connectionError(error) {
 const message = String(error?.message || '')
 const status = Number(error?.status || error?.statusCode || message.match(/\b(401|403|404|422|502|503|504)\b/)?.[1])
 if (status === 401 || status === 403) return `رفض تسجيل الدخول (${status}). أعد ربط اتصال Hermes من إعدادات التطبيق.`
 if (status === 404) return 'المسار غير موجود على الاتصال المستخدم (404). تحقق أن التطبيق متصل بخادم البلوقين المحدّث.'
 if (status === 503 && /auth|provider|مصادقة/i.test(message)) return 'خدمة المصادقة في الخادم غير متاحة (503)، وليست مشكلة في سجل المهام.'
 if (status) return `تعذر طلب بيانات التنفيذ (HTTP ${status}).`
 if (/Invalid execution history response/.test(message)) return 'وصلت بيانات بصيغة غير متوافقة. حدّث واجهة البلوقين وجزء الخادم معًا.'
 if (/Gateway selection changed/.test(message)) return 'تغيّر الاتصال أثناء القراءة. اضغط تحديث بعد استقرار الاتصال.'
 if (/timeout|timed out/i.test(message)) return 'انتهت مهلة اتصال التطبيق بالخادم. تحقق من الاتصال وأعد المحاولة.'
 return 'تعذر الاتصال عبر جسر تطبيق Hermes. أعد فتح اتصال الخادم؛ لا توجد بيانات تشخيصية كافية لتحديد السبب.'
}

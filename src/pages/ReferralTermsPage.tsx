import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Badge } from '@/components/ui/badge';
import { usePublicReferralSettings } from '@/hooks/useReferralProgram';
import { formatRate } from '@/lib/referrals';

/** Referral programme terms (EN/AR). DRAFT for the lawyer: wording to be reviewed before it is final. */
export default function ReferralTermsPage() {
  const { i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const { settings: s } = usePublicReferralSettings();
  const rate = formatRate(s.rate_percent);
  const min = `$${s.min_payout}`;

  const en = [
    ['1. Who can take part', 'Any consultant registered on AI Support 360 can share their personal referral code or link with other SAP consultants. Taking part is voluntary and free.'],
    ['2. How a referral is recorded', 'A referral is recorded only when the new consultant signs up with your code or link (or enters it within a few days of creating the account, before their first paid ticket). Each consultant can have only one referrer, and it cannot be changed afterwards except by AI Support 360 to correct a mistake.'],
    ['Activation: both must pass the AI interview', `A referral becomes active only when BOTH consultants (the referrer and the consultant who registered with the code) have completed the AI interview with an overall score of at least ${s.pass_mark}, and BOTH have accepted these terms. The interview must be taken honestly, by the consultant alone and without outside help. If you do not pass, you can retake the interview under the normal interview rules and the referral stays pending. If the referral is not active within ${s.activation_days} days of the sign-up it expires; only AI Support 360 can revive it. Rewards are earned only on work invoiced after the moment the referral became active. Activation never lifts a review or hold for suspected fraud.`],
    ['3. The reward', `You earn ${rate} % of the fee of the consultant you referred (their approved hourly rate multiplied by the approved hours) for ${s.months} months, counted from their first paid ticket. The reward is paid by AI Support 360 out of its own platform fee. It is never deducted from the referred consultant's payout and never added to the client's price. It is not calculated on VAT, the platform service fee, payment fees or on your own work.`],
    ['4. When you earn', 'A reward is created only after the client has paid and the referred consultant\'s fee for those hours has been released, and only while both of you are verified, your account is not suspended and you have accepted the Consultant Service Policy.'],
    ['5. Payment', `Rewards are "pending" until the referred consultant's payout is completed, then "available". Once your available rewards reach ${min} (in the same currency), they are paid with the normal payout run, within the usual 15 business days, to the bank details already saved in your account.`],
    ['6. Refunds and disputes', 'If a client payment is refunded or charged back, the related reward is reversed. If it is disputed, the reward is held until the dispute is settled. A reversed reward that was already paid is deducted from your next referral payout.'],
    ['7. Fair use', 'Self-referrals, referral loops, fake or duplicate accounts and shared bank accounts are not allowed. Referrals with such signals are held for review; AI Support 360 may withhold, reverse or adjust rewards and switch off a code, and will tell you why.'],
    ['8. Privacy', 'You see only the public name format of the consultants you referred, their status and dates. You never see their full name, contact details or earnings.'],
    ['9. Taxes', 'Referral rewards are a referral incentive, not wages or salary. They may be taxable; you are responsible for declaring them where you live.'],
    ['10. Changes', 'AI Support 360 may change or end the programme for future rewards with notice on this page. Rewards already earned are not affected.'],
  ];
  const arText = [
    ['1. من يمكنه المشاركة', 'يمكن لأي مستشار مسجّل في AI Support 360 مشاركة رمز الإحالة أو الرابط الخاص به مع مستشاري SAP الآخرين. المشاركة اختيارية ومجانية.'],
    ['2. كيف تُسجَّل الإحالة', 'تُسجَّل الإحالة فقط عندما يسجّل المستشار الجديد باستخدام رمزك أو رابطك (أو يُدخله خلال أيام قليلة من إنشاء الحساب وقبل أول تذكرة مدفوعة). لكل مستشار مُحيل واحد فقط، ولا يمكن تغييره لاحقًا إلا من قِبل AI Support 360 لتصحيح خطأ.'],
    ['التفعيل: يجب أن يجتاز كلاكما المقابلة الذكية', `تصبح الإحالة نشطة فقط عندما يكمل المستشاران كلاهما (المُحيل والمستشار الذي سجّل بالرمز) المقابلة الذكية بدرجة إجمالية لا تقل عن ${s.pass_mark}، ويوافق كلاهما على هذه الشروط. يجب إجراء المقابلة بأمانة، من المستشار وحده ودون أي مساعدة خارجية. إذا لم تنجح يمكنك إعادة المقابلة وفق قواعد المقابلات المعتادة وتبقى الإحالة قيد الانتظار. إذا لم تصبح الإحالة نشطة خلال ${s.activation_days} يومًا من التسجيل تنتهي صلاحيتها، ولا يعيد تفعيلها إلا AI Support 360. تُستحق المكافآت فقط عن الأعمال المفوترة بعد لحظة تفعيل الإحالة. ولا يرفع التفعيل أي مراجعة أو تعليق بسبب اشتباه في الاحتيال.`],
    ['3. المكافأة', `تحصل على ${rate} % من أتعاب المستشار الذي أحلته (سعره بالساعة المعتمد مضروبًا في الساعات المعتمدة) لمدة ${s.months} شهرًا تبدأ من أول تذكرة مدفوعة له. تدفع AI Support 360 المكافأة من رسوم المنصة الخاصة بها، ولا تُخصم أبدًا من مستحقات المستشار المُحال ولا تُضاف إلى سعر العميل، ولا تُحسب على ضريبة القيمة المضافة أو رسوم خدمة المنصة أو رسوم الدفع أو على عملك أنت.`],
    ['4. متى تستحق المكافأة', 'تُنشأ المكافأة فقط بعد أن يدفع العميل وتُصرف أتعاب المستشار المُحال عن تلك الساعات، وفقط ما دام كلاكما موثّقًا، وحسابك غير موقوف، وقد وافقت على سياسة خدمة المستشارين.'],
    ['5. الدفع', `تكون المكافآت "قيد الانتظار" حتى تكتمل دفعة المستشار المُحال، ثم تصبح "متاحة". عندما تبلغ مكافآتك المتاحة ${min} (بالعملة نفسها) تُدفع مع دورة الدفعات المعتادة، خلال 15 يوم عمل كالمعتاد، إلى بيانات البنك المحفوظة في حسابك.`],
    ['6. الاسترداد والنزاعات', 'إذا استُردّت دفعة العميل أو أُلغيت، تُعكس المكافأة المرتبطة بها. وإذا كانت محل نزاع، تُعلَّق المكافأة حتى تتم تسوية النزاع. والمكافأة المعكوسة التي دُفعت سابقًا تُخصم من دفعة الإحالة التالية.'],
    ['7. الاستخدام العادل', 'لا يُسمح بإحالة النفس أو الإحالات الدائرية أو الحسابات الوهمية أو المكررة أو الحسابات البنكية المشتركة. تُعلَّق الإحالات التي تظهر عليها هذه المؤشرات للمراجعة، ويجوز لـ AI Support 360 حجب المكافآت أو عكسها أو تعديلها وإيقاف الرمز، مع إخبارك بالسبب.'],
    ['8. الخصوصية', 'ترى فقط صيغة الاسم العامة للمستشارين الذين أحلتهم وحالتهم والتواريخ، ولا ترى أبدًا أسماءهم الكاملة أو بيانات التواصل أو أرباحهم.'],
    ['9. الضرائب', 'مكافآت الإحالة حافز إحالة وليست أجرًا أو راتبًا. قد تخضع للضريبة، وأنت مسؤول عن الإقرار بها في بلد إقامتك.'],
    ['10. التغييرات', 'يجوز لـ AI Support 360 تغيير البرنامج أو إنهاؤه بالنسبة للمكافآت المستقبلية مع إشعار في هذه الصفحة. ولا تتأثر المكافآت المكتسبة سابقًا.'],
  ];
  const items = ar ? arText : en;

  return (
    <main id="main-content" dir={ar ? 'rtl' : 'ltr'} className="container mx-auto max-w-3xl px-4 py-12">
      <Helmet>
        <title>{ar ? 'شروط برنامج الإحالة | AI Support 360' : 'Referral programme terms | AI Support 360'}</title>
        <meta name="description" content={ar ? 'شروط برنامج إحالة المستشارين في AI Support 360.' : 'Terms of the AI Support 360 consultant referral programme.'} />
      </Helmet>
      <Badge variant="outline" className="mb-3">{ar ? 'مسودة - بانتظار مراجعة المحامي' : 'Draft - to be reviewed by our lawyer'}</Badge>
      <h1 className="text-3xl font-bold text-foreground">{ar ? 'شروط برنامج الإحالة' : 'Referral programme terms'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{ar ? 'الإصدار' : 'Version'} {s.terms_version}</p>
      <div className="mt-8 space-y-6">
        {items.map(([h, p], i) => (
          <section key={h}>
            <h2 className="text-lg font-semibold text-foreground">{i + 1}. {h.replace(/^\d+\.\s*/, '')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p}</p>
          </section>
        ))}
      </div>
    </main>
  );
}

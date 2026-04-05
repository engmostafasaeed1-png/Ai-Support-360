export const mockConsultantDetailData = {
  bio: 'Senior SAP S/4HANA Finance consultant with 12+ years of experience across GCC enterprises. Specialized in month-end close optimization, Financial Accounting (FI), Controlling (CO), and migration from ECC to S/4HANA. I have successfully led 20+ S/4HANA implementation and migration projects for Fortune 500 companies in Oil & Gas, Banking, and Manufacturing sectors. Passionate about leveraging SAP best practices to drive operational efficiency and financial transparency.',
  responseTime: 8,
  languages: ['English', 'Arabic'],
  industries: ['Oil & Gas', 'Banking', 'Manufacturing', 'Retail', 'Government'],
  certifications: [
    { name: 'SAP Certified Application Associate - S/4HANA Finance', issuer: 'SAP', year: '2023', verified: true },
    { name: 'SAP Certified Application Associate - Financial Accounting', issuer: 'SAP', year: '2021', verified: true },
    { name: 'SAP Certified Technology Associate - SAP Fiori', issuer: 'SAP', year: '2024', verified: true },
    { name: 'PMP - Project Management Professional', issuer: 'PMI', year: '2020', verified: false },
  ],
  skills: [
    { module: 'SAP S/4HANA Finance', proficiency: 5, years: 8, certified: true },
    { module: 'SAP FI/CO', proficiency: 5, years: 12, certified: true },
    { module: 'SAP MM', proficiency: 4, years: 6, certified: true },
    { module: 'SAP Fiori/UX', proficiency: 4, years: 4, certified: false },
    { module: 'SAP BTP/CPI', proficiency: 3, years: 2, certified: false },
    { module: 'ABAP Development', proficiency: 3, years: 5, certified: false },
  ],
  availableSlots: [
    { time: '09:00 - 10:00', type: 'video' as const, duration: 60 },
    { time: '11:00 - 11:45', type: 'screen_share' as const, duration: 45 },
    { time: '14:00 - 14:30', type: 'chat' as const, duration: 30 },
    { time: '16:00 - 17:00', type: 'video' as const, duration: 60 },
  ],
  reviews: [
    { client: 'Saudi Petrochemical Corp', avatar: 'SP', score: 5, comment: 'Outstanding S/4HANA knowledge. Resolved our month-end issue in one session. Highly recommended for any finance-related SAP challenges.', date: 'Mar 30, 2026', module: 'SAP S/4HANA' },
    { client: 'Al-Faisal Industries', avatar: 'AF', score: 5, comment: 'Very responsive and professional. Great FI/CO expertise. Ahmed went above and beyond to ensure our cost center reports were accurate.', date: 'Mar 25, 2026', module: 'SAP FI/CO' },
    { client: 'GCC Retail Group', avatar: 'GR', score: 4, comment: 'Good Fiori support, resolved our launchpad configuration quickly. Would have liked a follow-up document.', date: 'Mar 20, 2026', module: 'SAP Fiori/UX' },
    { client: 'Riyadh National Bank', avatar: 'RN', score: 5, comment: 'Excellent MM expertise. Fixed our PO workflow blockage within hours. Very knowledgeable and patient.', date: 'Mar 15, 2026', module: 'SAP MM' },
    { client: 'Jeddah Logistics Co', avatar: 'JL', score: 4, comment: 'Good integration knowledge. Helped us connect our BTP services smoothly.', date: 'Mar 10, 2026', module: 'SAP BTP/CPI' },
  ],
};

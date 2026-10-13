/** Guide content for the 9 consultant onboarding steps (English; components translate it with t() and these texts as defaults). */
export type GuideAffect = 'Matching' | 'Trust score' | 'Payouts' | 'Bids';

export type GuideStepKey =
  | 'import' | 'profile' | 'skills' | 'certifications' | 'work' | 'education' | 'projects' | 'availability' | 'interview';

export interface GuideStep {
  key: GuideStepKey;
  title: string;
  minutes: number;
  why: string;
  tips: string[];
  clientsSee: string;
  mistakes: string[];
  affects: GuideAffect[];
}

export const GUIDE_STEP_ORDER: GuideStepKey[] = [
  'import', 'profile', 'skills', 'certifications', 'work', 'education', 'projects', 'availability', 'interview',
];

export const CONSULTANT_GUIDE: Record<GuideStepKey, GuideStep> = {
  import: {
    key: 'import',
    title: 'Import your CV or LinkedIn profile',
    minutes: 2,
    why: 'Importing your CV or LinkedIn profile fills most of the next steps for you and saves typing.',
    tips: [
      'Use your most recent CV in English',
      'Review every field the import fills before you continue',
      'You can skip this step and type everything yourself',
    ],
    clientsSee: 'Clients do not see the imported file, only the details you keep in the next steps.',
    mistakes: [
      'Continuing without checking the imported dates, titles and modules',
      'Importing an old CV that misses your latest projects',
    ],
    affects: ['Matching'],
  },
  profile: {
    key: 'profile',
    title: 'Profile, rate and languages',
    minutes: 4,
    why: 'Your headline, bio and rate are the first things a client reads before choosing you.',
    tips: [
      'Open the bio with your strongest SAP module and years of experience',
      "Mention industries and project types, not employers' secrets",
      'Set a rate you are happy to be paid: clients approve it before work starts',
      'Add a clear photo: profiles with photos get more invitations',
    ],
    clientsSee: 'Clients see your name, bio, rate, languages and location on your profile and in match results.',
    mistakes: [
      'Phone numbers, e-mails or links in the bio are blocked: contact details are shared inside the portal once you are assigned',
      'Leaving the rate at 0',
    ],
    affects: ['Matching', 'Bids'],
  },
  skills: {
    key: 'skills',
    title: 'SAP skills',
    minutes: 3,
    why: 'Your SAP modules, levels and years are the strongest signal the AI matching uses to send you requests.',
    tips: [
      'Pick only the modules you really delivered',
      'Give honest levels: the AI interview checks them',
      'Count the years you actually worked hands-on in each module',
    ],
    clientsSee: 'Clients see your modules and levels, and the matching ranks you for requests in those modules.',
    mistakes: [
      'Adding every module you have heard of: it lowers the quality of your matches',
      'Rating every skill at the highest level',
    ],
    affects: ['Matching', 'Trust score'],
  },
  certifications: {
    key: 'certifications',
    title: 'Certifications',
    minutes: 3,
    why: 'Certified consultants are ranked higher and verified faster.',
    tips: [
      'Upload the certificate file for each certification',
      'Use the exact certificate name and issuer',
      'Add the issue and expiry dates',
    ],
    clientsSee: 'Clients see your certificate names, and a checked mark once the platform team has verified them.',
    mistakes: [
      'Adding a certificate without uploading the file',
      'Listing expired certificates as current',
    ],
    affects: ['Trust score', 'Matching'],
  },
  work: {
    key: 'work',
    title: 'Work experience',
    minutes: 4,
    why: 'Your experience shows clients what you have done before, in which role and with which results.',
    tips: [
      'Describe what YOU did, not what the team did',
      'Give results in numbers, for example go-live dates, users or time saved',
      'Keep each entry short and in your own words',
    ],
    clientsSee: 'Clients see your job titles, periods and descriptions on your profile.',
    mistakes: [
      'Copying the job description instead of your own work',
      'Naming confidential client details',
    ],
    affects: ['Matching', 'Trust score'],
  },
  education: {
    key: 'education',
    title: 'Education',
    minutes: 2,
    why: 'Your education completes your profile and helps clients who require a degree.',
    tips: [
      'Add your highest degree first',
      'Use the official name of the institution',
      'Add the field of study and the years',
    ],
    clientsSee: 'Clients see your degrees and institutions on your profile.',
    mistakes: [
      'Leaving the field of study empty',
      'Adding short courses here instead of under certifications',
    ],
    affects: ['Trust score'],
  },
  projects: {
    key: 'projects',
    title: 'Projects',
    minutes: 4,
    why: 'Your projects tell the AI matching which industries, modules and roles you know best.',
    tips: [
      'Add the industry of each project',
      'Select the SAP modules you worked on',
      'State your role, for example lead consultant or solution architect',
      'Add the duration in months',
    ],
    clientsSee: 'Clients see your project names, industries, modules and role; the AI matching uses them to rank you.',
    mistakes: [
      'Leaving the modules empty',
      'Using the client company name when it is confidential',
    ],
    affects: ['Matching'],
  },
  availability: {
    key: 'availability',
    title: 'Availability',
    minutes: 2,
    why: 'Your weekly slots tell clients when they can book you.',
    tips: [
      'Set your weekly slots in your own time zone',
      'Add only the hours you can really keep',
      'Update your slots before holidays',
    ],
    clientsSee: 'Clients book sessions only inside the slots you set here.',
    mistakes: [
      'Choosing the wrong time zone',
      'Offering slots you can not keep',
    ],
    affects: ['Matching', 'Bids'],
  },
  interview: {
    key: 'interview',
    title: 'AI interview',
    minutes: 15,
    why: 'The AI voice interview checks your SAP knowledge in 10-15 minutes, and its score adds to your trust score.',
    tips: [
      'Allow camera and microphone access when the browser asks',
      'Sit in a quiet place with a stable connection',
      'Answer with real project examples',
    ],
    clientsSee: 'Clients see your interview badge and the trust score it adds to.',
    mistakes: [
      'Blocking the camera or microphone permission',
      'Giving short, general answers without examples',
    ],
    affects: ['Trust score', 'Matching'],
  },
};

/** One sentence per key field, shown in the "Why we ask" tooltips. */
export const fieldHints = {
  displayName: 'Clients see this name on your profile and in match results.',
  bio: 'Your bio is the first text a client reads before choosing you.',
  hourlyRate: 'Clients approve your rate before any work starts.',
  languages: 'Requests are matched to consultants who speak the client’s language.',
  timezone: 'Your availability and session times are shown in this time zone.',
  linkedin: 'The platform team opens your LinkedIn profile when it reviews your application.',
  skillLevel: 'Give an honest level: the AI interview checks it.',
  skillYears: 'Years of hands-on work in a module help the matching rank you.',
  availability: 'Clients can book you only inside these weekly slots.',
  interview: 'The interview score adds to your trust score, which clients can see.',
} as const;

export type FieldHintKey = keyof typeof fieldHints;

export const totalGuideMinutes = (): number => GUIDE_STEP_ORDER.reduce((n, k) => n + CONSULTANT_GUIDE[k].minutes, 0);

/** Minutes left from the given step index (including it). */
export const minutesLeft = (stepIndex: number): number =>
  GUIDE_STEP_ORDER.slice(Math.max(0, stepIndex)).reduce((n, k) => n + CONSULTANT_GUIDE[k].minutes, 0);

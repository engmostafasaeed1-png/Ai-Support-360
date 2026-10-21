import * as React from 'npm:react@18.3.1';
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22';
import type { TemplateEntry } from './registry.ts';
import { adminSubject, safeAdminLink } from '../admin-notification-email.ts';
import { PauseFooter } from './pause-footer.tsx';
import type { PauseLinks } from '../notificationPause.ts';
interface Props { title?: string; body?: string; link?: string; pauseLinks?: PauseLinks }
const AdminNotification = ({ title = '', body = '', link, pauseLinks }: Props) => {
  const href = safeAdminLink(link);
  return <Html lang="en" dir="ltr"><Head /><Preview>{title}</Preview>
    <Body style={main}><Container style={container}>
      <Text style={brand}>AI Support 360</Text><Heading style={heading}>{title}</Heading>
      <Text style={text}>{body}</Text>
      {href && <Button href={href} style={button}>View notification</Button>}
      <PauseFooter links={pauseLinks} lang="en" />
    </Container></Body></Html>;
};
export const template = {
  component: AdminNotification,
  subject: (data: Record<string, any>) => adminSubject(String(data.title ?? '')),
  displayName: 'Administrator notification',
  previewData: { title: 'Payment reported', body: 'A client reported a bank transfer.', link: '/admin/payments' },
} satisfies TemplateEntry;
const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' };
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' };
const brand = { color: '#1B2559', fontSize: '14px', fontWeight: 'bold' };
const heading = { color: '#1B2559', fontSize: '24px' };
const text = { color: '#334155', fontSize: '15px', lineHeight: '1.6', whiteSpace: 'pre-wrap' as const };
const button = { backgroundColor: '#1B2559', color: '#ffffff', padding: '12px 20px', borderRadius: '8px', fontSize: '15px' };
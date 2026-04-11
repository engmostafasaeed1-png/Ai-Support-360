import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'a'];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

interface SafeMarkdownProps {
  content: string;
}

export default function SafeMarkdown({ content }: SafeMarkdownProps) {
  const clean = DOMPurify.sanitize(content, { ALLOWED_TAGS, ALLOWED_ATTR });

  return (
    <ReactMarkdown
      components={{
        a: ({ href, children, ...props }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        ),
      }}
    >
      {clean}
    </ReactMarkdown>
  );
}

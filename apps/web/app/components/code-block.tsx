export function CodeBlock({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <pre className={`overflow-x-auto rounded-lg bg-code-bg p-3 text-xs whitespace-pre-wrap text-code-fg ${className}`}>
      <code>{children}</code>
    </pre>
  )
}

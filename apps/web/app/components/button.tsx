import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-hover active:scale-[0.97]',
  secondary: 'border border-border bg-surface hover:bg-black/5 active:scale-[0.97]',
  ghost: 'hover:bg-black/5 active:scale-[0.97]',
  danger: 'bg-critical text-white hover:opacity-90 active:scale-[0.97]',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  )
}

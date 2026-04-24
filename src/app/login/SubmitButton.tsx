'use client'

import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'

interface SubmitButtonProps {
    children: React.ReactNode
    className?: string
    formAction?: (formData: FormData) => void
}

export function SubmitButton({ children, className, formAction }: SubmitButtonProps) {
    const { pending } = useFormStatus()

    return (
        <button
            type="submit"
            formAction={formAction}
            disabled={pending}
            className={`${className} flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed`}
        >
            {pending ? (
                <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>מתחבר...</span>
                </>
            ) : (
                children
            )}
        </button>
    )
}

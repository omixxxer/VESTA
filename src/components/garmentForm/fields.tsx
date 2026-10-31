import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'

// Small building blocks of the garment form.

export function SuggestedBadge() {
  return <span className="suggested-badge" title="Rellenado por el análisis; revísalo">Sugerido</span>
}

export function FieldHeading({ htmlFor, label, hint, suggested }: { htmlFor?: string; label: string; hint?: string; suggested?: boolean }) {
  return (
    <div className="field-heading">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {hint && <small>{hint}</small>}
      {suggested && <SuggestedBadge />}
    </div>
  )
}

interface ChipsFieldProps {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  options: string[]
  placeholder: string
  suggested?: boolean
}

/** A list of short values edited as chips; Enter, comma or leaving the field adds what was typed. */
export function ChipsField({ label, values, onChange, options, placeholder, suggested }: ChipsFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState('')

  function add(text: string) {
    const additions = text.split(',').map((value) => value.trim()).filter(Boolean)
    const known = new Set(values.map((value) => value.toLocaleLowerCase('es')))
    const fresh = additions.filter((value) => {
      const key = value.toLocaleLowerCase('es')
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    if (fresh.length) onChange([...values, ...fresh])
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add(draft)
      setDraft('')
    } else if (event.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="form-field full">
      <FieldHeading htmlFor={id} label={label} suggested={suggested} />
      <div className="chips-input">
        {values.map((value) => (
          <span className="chip" key={value}>
            {value}
            <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Quitar ${value}`}>×</button>
          </span>
        ))}
        <input
          id={id}
          list={`${id}-options`}
          value={draft}
          onChange={(event) => {
            const text = event.target.value
            if (text.includes(',')) {
              add(text)
              setDraft('')
            } else {
              setDraft(text)
            }
          }}
          onKeyDown={keyDown}
          onBlur={() => {
            add(draft)
            setDraft('')
          }}
          placeholder={values.length ? 'Añadir…' : placeholder}
        />
        <datalist id={`${id}-options`}>
          {options.filter((option) => !values.includes(option)).map((option) => <option key={option} value={option} />)}
        </datalist>
      </div>
    </div>
  )
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      <div className="form-grid">{children}</div>
    </fieldset>
  )
}

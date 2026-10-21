import { useEffect, useRef, useState } from 'react'
import type { Garment } from '../types/domain'
import { useObjectUrl } from './useObjectUrl'
import GarmentForm from './GarmentForm'

interface GarmentDetailPanelProps {
  garment: Garment
  onClose: () => void
  onSave: (garment: Garment) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(date))
}

export default function GarmentDetailPanel({ garment, onClose, onSave, onDelete }: GarmentDetailPanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const imageUrl = useObjectUrl(garment.image)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex="0"]'
      ))
      if (!focusable.length) {
        event.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])

  async function confirmDelete() {
    if (!window.confirm('¿Eliminar esta prenda? No se puede deshacer')) return
    setDeleteError('')
    try {
      await onDelete(garment.id)
      onClose()
    } catch {
      setDeleteError('No se pudo eliminar la prenda. Inténtalo de nuevo.')
    }
  }

  return (
    <div className="panel-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panelRef} className={`detail-panel ${isEditing ? 'editing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="detail-title" tabIndex={-1}>
        <header className="detail-header">
          <p className="eyebrow">{isEditing ? 'EDITAR PRENDA' : 'DETALLE DE LA PRENDA'}</p>
          <button className="close-button" type="button" onClick={onClose} aria-label="Cerrar detalle">×</button>
        </header>
        {isEditing ? (
          <>
            <h2 className="detail-heading" id="detail-title">Editar prenda</h2>
            <GarmentForm
              garment={garment}
              onSave={async (updated) => {
                await onSave(updated)
                setIsEditing(false)
              }}
              onCancel={() => setIsEditing(false)}
            />
          </>
        ) : (
          <>
            <h2 className="detail-heading" id="detail-title">{garment.name.trim() || garment.subcategory || garment.category}</h2>
            {imageUrl && <img className="detail-photo" src={imageUrl} alt={garment.name || garment.category} />}
            <dl className="property-list">
              <div><dt>Categoría</dt><dd>{garment.category}{garment.subcategory && ` · ${garment.subcategory}`}</dd></div>
              <div><dt>Colores</dt><dd>{garment.colors.join(', ') || 'Sin especificar'}</dd></div>
              <div><dt>Marca</dt><dd>{garment.brand || 'Sin especificar'}</dd></div>
              <div><dt>Talla</dt><dd>{garment.size || 'Sin especificar'}</dd></div>
              <div><dt>Temporadas</dt><dd>{garment.seasons.join(', ') || 'Sin especificar'}</dd></div>
              <div><dt>Estilos</dt><dd>{garment.styles.join(', ') || 'Sin especificar'}</dd></div>
              <div><dt>Formalidad</dt><dd>{garment.formality}</dd></div>
              {garment.analysis && (
                <div className="property-notes">
                  <dt>Procedencia del análisis</dt>
                  <dd>
                    Sugerencias locales de {garment.analysis.modelId} ({garment.analysis.modelVersion.slice(0, 8)}).
                    {' '}Categoría: CLIP zero-shot; color: muestreo de píxeles.
                    {' '}Puntuación no calibrada de categoría: {((garment.analysis.confidenceByAttribute.category ?? 0) * 100).toFixed(1)}%;
                    {' '}predominio heurístico del color: {((garment.analysis.confidenceByAttribute.colors ?? 0) * 100).toFixed(1)}%.
                    {' '}Atributos corregidos: {garment.analysis.correctedAttributes.join(', ') || 'ninguno registrado'}.
                    {' '}Sin detección validada de {garment.analysis.unknownAttributes.join(', ')}.
                  </dd>
                </div>
              )}
              {garment.notes && <div className="property-notes"><dt>Notas</dt><dd>{garment.notes}</dd></div>}
              <div><dt>Añadida</dt><dd>{formatDate(garment.createdAt)}</dd></div>
            </dl>
            {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            <footer className="detail-actions">
              <button className="button button-danger" type="button" onClick={() => void confirmDelete()}>Eliminar</button>
              <button className="button button-dark" type="button" onClick={() => setIsEditing(true)}>Editar</button>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}

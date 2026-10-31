import GarmentPhoto from '../GarmentPhoto'
import { LatticeLoader } from '../reactBits'

/** [field, value used, text as read] for each field the label gave. */
export type LabelFinding = readonly [string, string | undefined, string | undefined]

interface LabelPhotoSlotProps {
  id: string
  photo: Blob | undefined
  reading: boolean
  /** The label has been read (even if nothing was recognised). */
  read: boolean
  findings: LabelFinding[]
  error: string
  disabled: boolean
  onSelect: (file: File | undefined) => void
  onRead: (photo: Blob) => void
  onRemove: () => void
}

/** The care label's own photo: only read for brand, size and composition, never classified. */
export default function LabelPhotoSlot({ id, photo, reading, read, findings, error, disabled, onSelect, onRead, onRemove }: LabelPhotoSlotProps) {
  return (
    <section className="label-slot" aria-labelledby={`${id}-label-title`}>
      <div className="label-slot-header">
        <p className="analysis-label" id={`${id}-label-title`}>Foto de la etiqueta</p>
        <small>Opcional · solo se lee el texto</small>
      </div>
      {photo ? (
        <div className="label-slot-body">
          <GarmentPhoto image={photo} alt="Etiqueta de la prenda" />
          <div className="label-slot-reading" role="status">
            {reading && <LatticeLoader label="Leyendo la etiqueta" pattern="snake" fontSize={10} cellSize={4} />}
            {!reading && findings.length > 0 && (
              <dl className="analysis-read">
                {findings.map(([label, value, text]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}{text && text.toLocaleLowerCase('es') !== value?.toLocaleLowerCase('es') && <> <q>{text}</q></>}</dd></div>
                ))}
              </dl>
            )}
            {!reading && read && !findings.length && !error && (
              <p className="analysis-progress">No se ha reconocido marca, talla ni composición.</p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="label-slot-actions">
              {!read && !reading && <button type="button" onClick={() => onRead(photo)} disabled={disabled}>Leer etiqueta</button>}
              <button type="button" onClick={onRemove} disabled={disabled} aria-label="Quitar foto de la etiqueta">Quitar</button>
            </div>
          </div>
        </div>
      ) : (
        <label className="label-upload">
          <span aria-hidden="true">＋</span>
          <span>Añadir foto de la etiqueta <small>para leer marca, talla y composición; no cuenta para el tipo ni el color</small></span>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => {
              onSelect(event.currentTarget.files?.[0])
              event.currentTarget.value = ''
            }}
            aria-label="Seleccionar foto de la etiqueta"
          />
        </label>
      )}
      {!photo && error && <p className="form-error" role="alert">{error}</p>}
    </section>
  )
}

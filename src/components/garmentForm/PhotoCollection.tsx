import GarmentPhoto from '../GarmentPhoto'

interface PhotoCollectionProps {
  photos: Blob[]
  max: number
  disabled: boolean
  /** Files chosen by the user, still to be checked. */
  onAdd: (files: FileList | null) => void
  /** The new list after making a photo the main one or removing it. */
  onChange: (photos: Blob[]) => void
}

/** The garment's photos: the first is the main one; another can be made main or any removed. */
export default function PhotoCollection({ photos, max, disabled, onAdd, onChange }: PhotoCollectionProps) {
  return (
    <div className="photo-collection">
      {photos.map((photo, index) => (
        <div className="photo-card" key={`${index}-${photo.size}-${photo.type}`}>
          <GarmentPhoto image={photo} alt={`Foto ${index + 1} de la prenda`} />
          <div className="photo-card-actions">
            {index === 0
              ? <span>Foto principal</span>
              : <button type="button" onClick={() => onChange([photo, ...photos.filter((_, photoIndex) => photoIndex !== index)])} disabled={disabled}>Hacer principal</button>}
            <button type="button" onClick={() => onChange(photos.filter((_, photoIndex) => photoIndex !== index))} disabled={disabled} aria-label={`Quitar foto ${index + 1}`}>Quitar</button>
          </div>
        </div>
      ))}
      {photos.length < max && <label className="photo-upload">
        <span className="upload-placeholder"><span aria-hidden="true">＋</span><strong>{photos.length ? 'Añadir otra foto' : 'Añade fotos de la prenda'}</strong><small>Hasta {max} fotos · JPG, PNG o WebP · 8 MB cada una</small></span>
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          capture="environment"
          multiple
          onChange={(event) => {
            onAdd(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
          aria-label="Seleccionar fotografía de la prenda"
        />
      </label>}
    </div>
  )
}

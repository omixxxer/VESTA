import { MODEL_DOWNLOAD_SIZE, type ClothingAnalysisSuggestion } from '../../ai/clothingAnalyzer'
import { LatticeLoader } from '../reactBits'

type Alternative = ClothingAnalysisSuggestion['alternatives'][number]

interface AnalysisCardProps {
  analyzing: boolean
  photoCount: number
  suggestion: ClothingAnalysisSuggestion | undefined
  /** The label photo gave a brand, which takes precedence over one read on the garment. */
  labelHasBrand: boolean
  error: string
  disabled: boolean
  onAlternative: (alternative: Alternative) => void
  onAnalyze: () => void
}

function percent(value: number): string {
  return value.toLocaleString('es', { style: 'percent', maximumFractionDigits: 0 })
}

/** What the model suggests from the garment photos, its alternatives, and how the analysis works. */
export default function AnalysisCard({ analyzing, photoCount, suggestion, labelHasBrand, error, disabled, onAlternative, onAnalyze }: AnalysisCardProps) {
  const shape = suggestion && [suggestion.sleeve?.label, suggestion.fit && `Corte ${suggestion.fit.label.toLocaleLowerCase('es')}`].filter(Boolean)
  return (
    <>
      <div className="analysis-card" role="status">
        {analyzing && <LatticeLoader label={`Analizando ${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'}`} fontSize={11} cellSize={5} />}
        {!analyzing && suggestion && (
          <>
            <p className="analysis-label">Sugerencia del análisis</p>
            <p className="analysis-main">{suggestion.subcategory || suggestion.category}</p>
            <p className="analysis-meta">
              {suggestion.subcategory ? `${suggestion.category} · ` : ''}
              {percent(suggestion.confidenceByAttribute.category ?? 0)} de confianza{suggestion.calibrated ? '' : ' (no calibrada)'}
            </p>
            {suggestion.alternatives.length > 0 && (
              <div className="analysis-alternatives">
                <span>¿No es esto?</span>
                {suggestion.alternatives.map((candidate) => (
                  <button
                    type="button"
                    key={`${candidate.category}-${candidate.subcategory}`}
                    aria-label={`${candidate.category}${candidate.subcategory ? ` · ${candidate.subcategory}` : ''}`}
                    onClick={() => onAlternative(candidate)}
                    disabled={disabled}
                  >
                    {candidate.subcategory || candidate.category} <small>{percent(candidate.score)}</small>
                  </button>
                ))}
              </div>
            )}
            {shape && shape.length > 0 && (
              <p className="analysis-info">{shape.join(' · ')} <small>(informativo, no se guarda)</small></p>
            )}
            {suggestion.brand && !labelHasBrand && (
              <p className="analysis-info">Marca leída en la prenda: {suggestion.brand.brand}</p>
            )}
          </>
        )}
        {!analyzing && !suggestion && !error && (
          <p className="analysis-progress">{photoCount ? 'Pulsa «Analizar de nuevo» para obtener sugerencias.' : 'Añade una foto y sugeriremos tipo, color y estampado.'}</p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-outline analysis-again" type="button" onClick={onAnalyze} disabled={!photoCount || analyzing || disabled}>
          {analyzing ? 'Analizando…' : 'Analizar de nuevo'}
        </button>
      </div>

      <details className="analysis-details">
        <summary>¿Cómo se analiza?</summary>
        <p>Las fotos se analizan en este dispositivo y no se envían. El modelo de VESTA combina todas las fotos para sugerir categoría, subcategoría y estampado, y estima la manga o el corte del pantalón. El color se calcula por píxeles y puede captar el fondo. La marca se lee si aparece escrita (etiqueta, lengüeta…); los logos sin letras no se reconocen. Talla y composición salen de la foto de la etiqueta, que va en su propio campo y solo se usa para leer texto: no cuenta para el tipo ni el color. Temporadas, estilo y estética se sugieren según el tipo de prenda, la manga y la composición, y puedes cambiarlos. Las sugerencias nunca sustituyen lo que hayas escrito en marca, talla o composición. Descarga del modelo la primera vez: {MODEL_DOWNLOAD_SIZE}.</p>
      </details>
    </>
  )
}

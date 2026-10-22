import {dateLabel} from "@/lib/api";
import {officialStateReference} from "@/lib/official-state-sources";

export default function OfficialStateReference({state}: {state: string}) {
  const reference = officialStateReference(state);
  if (!reference) return null;
  return <div className="official-state-reference"><h3>Trámites y fuentes oficiales</h3><p className="small">{reference.note}</p><ul className="compact-list">{reference.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><span className="small muted"> · {source.kind === "program" ? "Documento / programa para consultar" : "Portal o referencia oficial"}</span></li>)}</ul><p className="small muted">Directorio contrastado el {dateLabel(reference.reviewedOn)}. No realiza pagos ni consulta tus datos en sitios externos. Revisa vigencia y modificaciones al efectuar el trámite.</p></div>;
}

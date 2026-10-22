/** Official entry points; linking a portal is not validation of its current legal rules. */
export const southernStateSources: Record<string, {
  reviewedOn: string;
  sources: {
    title: string;
    url: string;
    topic: "vehicle_control" | "verification" | "legislation" | "circulation";
    kind: "official_portal" | "program";
  }[];
  note: string;
}> = {
  "Campeche": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "SEAFI · Mi Portal SIAF, derechos vehiculares", url: "https://miportal-siaf.seafi.campeche.gob.mx/", topic: "vehicle_control", kind: "official_portal" },
      { title: "SEAFI · Marco normativo", url: "https://transparencia.safin.campeche.gob.mx/65-1/seafi", topic: "legislation", kind: "official_portal" },
    ],
    note: "Se revisaron el portal fiscal y el índice de normativa oficial. No se validaron todas las disposiciones ni sus excepciones por vehículo. Confirmar vigencia y trámite; obligaciones ambientales y de circulación pendientes de revisión individual.",
  },
  "Chiapas": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Finanzas · Requisitos para refrendo, placas y trámites vehiculares", url: "https://www.ingresos.haciendachiapas.gob.mx/services/vehicular/req-refrendo.html", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisó la ficha oficial de requisitos vehiculares actualizada en 2026, incluida la documentación de personas morales. No constituye revisión de toda la legislación estatal: confirmar plazos, vigencia, servicio y obligaciones ambientales antes de capturar fechas.",
  },
  "Colima": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Finanzas · Renovación anual de calcomanía fiscal vehicular", url: "https://www.col.gob.mx/Portal/DetalleTramiteReTYS/020121160901/1365", topic: "vehicle_control", kind: "official_portal" },
      { title: "Congreso · Aviso de ampliación de plazos vehiculares 2026", url: "https://congresocol.gob.mx/web/www/comunicacion/nota.php?nota=5911", topic: "legislation", kind: "official_portal" },
    ],
    note: "Se revisaron el trámite y el aviso oficial de ampliación de plazos 2026. Calcomanía fiscal no equivale a certificado ambiental. Confirmar el decreto aplicable, eventuales cambios y condiciones del vehículo; revisión legal integral pendiente.",
  },
  "Guerrero": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Finanzas · Consulta y pago de tenencia vehicular", url: "https://esefina.ingresos-guerrero.gob.mx/Tenencia/ModuloExterno/", topic: "vehicle_control", kind: "official_portal" },
      { title: "Oficina Virtual · Ficha de tenencia y refrendo de servicio público", url: "https://ovc.guerrero.gob.mx/tramite/688/PreguntaRespuesta", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se contrastaron el portal de tenencia y una ficha específica de servicio público. Esta ficha no determina las obligaciones de una unidad particular o empresarial. Confirmar clasificación, documento y norma vigente; revisión legal integral pendiente.",
  },
  "Michoacán": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "SATMICH · Trámites y derechos de control vehicular", url: "https://satmich.michoacan.gob.mx/tramites/vehicular/CostosVehiculares", topic: "vehicle_control", kind: "official_portal" },
      { title: "Gobierno de Michoacán · Portal de verificación vehicular", url: "https://www.michoacan.gob.mx/verificacion-vehicular/", topic: "verification", kind: "official_portal" },
    ],
    note: "Se revisaron la ficha fiscal con cuotas 2026 y el portal ambiental, que conserva información de 2025. No se trasladan calendarios ni reconocimientos de hologramas de 2025 a 2026. Confirmar programa vigente y aplicabilidad; revisión legal integral pendiente.",
  },
  "Nayarit": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Registro de Trámites · Refrendo vehicular", url: "https://tramites.nayarit.gob.mx/ciudadano/ficha/880", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisó la ficha oficial de refrendo, que todavía cita fundamento fiscal 2025. Su mención de verificación no acredita un programa ambiental 2026. Confirmar legislación, importe, naturaleza del trámite y vigencia; revisión legal integral pendiente.",
  },
  "Oaxaca": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Finanzas · Cédulas de trámites, tenencia y derechos vehiculares", url: "https://www.finanzasoaxaca.gob.mx/catalogo-de-tramites-y-servicios/", topic: "vehicle_control", kind: "official_portal" },
      { title: "Medio Ambiente · Verificación vehicular y centros autorizados", url: "https://www.oaxaca.gob.mx/medioambiente/verificacion-vehicular/", topic: "verification", kind: "official_portal" },
    ],
    note: "Se revisaron los portales fiscal y ambiental. Antes de aplicar fechas se requiere contrastar el programa, las excepciones y acuerdos vigentes en el Periódico Oficial. Las referencias no habilitan cálculo automático ni prueban cumplimiento de cada unidad.",
  },
  "Quintana Roo": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "SATQ · Tenencias y control vehicular", url: "https://satq.qroo.gob.mx/controlvehicular/", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisó el portal oficial de consulta vehicular. No se validaron plazos, subsidios ni todas las obligaciones de circulación o ambientales. Confirmar trámite, documentos y vigencia por unidad; no se presume exención de verificación.",
  },
  "Tabasco": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Tabasco · Requisitos para trámites vehiculares", url: "https://tabasco.gob.mx/requisitos-para-tramites-vehiculares-original", topic: "vehicle_control", kind: "official_portal" },
      { title: "Tabasco · Aviso de renovación de placas vehiculares 2026", url: "https://tabasco.gob.mx/comunicados/con-tramites-agiles-faciles-y-seguros-este-lunes-arranca-renovacion-de-placas", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se contrastaron requisitos oficiales y el aviso de renovación de placas 2026. Verificación de procedencia extranjera no equivale a verificación de emisiones. Confirmar programa, plazos y situación de cada unidad; revisión legal integral pendiente.",
  },
  "Yucatán": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Yucatán · Servicios y registro de control vehicular", url: "https://yucatan.gob.mx/ciudadano/ver_programa.php?id=171", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisó la referencia oficial de registro y reemplacamiento, incluida documentación de empresas. No se validó un calendario 2026 ni se prorrogan fechas de ejercicios anteriores. Confirmar documentos y reglas vigentes; revisión legal y ambiental integral pendiente.",
  },
  "Zacatecas": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Catálogo estatal · Derecho de control vehicular", url: "https://catalogoestatal.zacatecas.gob.mx/tramites/2615", topic: "vehicle_control", kind: "official_portal" },
      { title: "Finanzas · Trámites y servicios vehiculares", url: "https://sefin.zacatecas.gob.mx/tramites-y-servicios/", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisaron el catálogo oficial y los accesos de Finanzas. El portal conserva documentos de otros ejercicios; no se reutilizan sus cuotas o plazos automáticamente. Confirmar vigencia y obligaciones ambientales o de circulación; revisión legal integral pendiente.",
  },
};

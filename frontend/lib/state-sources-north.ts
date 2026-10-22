/** Reference directory, not an automated determination of legal obligations. */
export const northernStateSources: Record<string, {
  reviewedOn: string;
  sources: {
    title: string;
    url: string;
    topic: "vehicle_control" | "verification" | "legislation" | "circulation";
    kind: "official_portal" | "program";
  }[];
  note: string;
}> = {
  "Aguascalientes": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "SEFI · Pago de control vehicular", url: "https://epagos.aguascalientes.gob.mx/controlvehicular", topic: "vehicle_control", kind: "official_portal" },
      { title: "SSMAA · Verificación vehicular", url: "https://www.aguascalientes.gob.mx/SSMAA/secciones/programaVerificacion", topic: "verification", kind: "official_portal" },
    ],
    note: "Se revisaron los portales oficiales de control vehicular y verificación. Falta validar la normativa aplicable al tipo de vehículo y propietario; una unidad empresarial no debe recibir automáticamente el calendario de una persona física. Confirmar vigencia y trámite antes de registrar fechas.",
  },
  "Baja California": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Hacienda · Refrendo de tarjeta de circulación", url: "https://retys.bajacalifornia.gob.mx/Portal/TyS/1650?temaId=16", topic: "vehicle_control", kind: "official_portal" },
      { title: "Refrendo digital · Preguntas frecuentes", url: "https://refrendodigital.bajacalifornia.gob.mx/Home/FAQ", topic: "circulation", kind: "official_portal" },
      { title: "Medio Ambiente · Atribuciones y verificación vehicular", url: "https://www.bajacalifornia.gob.mx/medio_ambiente/Conocenos/Atribuciones", topic: "verification", kind: "official_portal" },
    ],
    note: "Se revisaron las referencias oficiales de refrendo y tarjeta de vigencia condicionada. Las atribuciones ambientales no prueban por sí solas un calendario operativo de verificación vigente. Confirmar programa, plazos y situación documental; revisión legal integral pendiente.",
  },
  "Baja California Sur": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Gobierno de BCS · Aviso de revista vehicular 2026", url: "https://www.bcs.gob.mx/vence-el-30-de-abril-el-plazo-para-pagar-revista-vehicular-2026-sin-recargos-sfyad/", topic: "vehicle_control", kind: "official_portal" },
      { title: "BCS · Catálogo oficial de trámites y servicios", url: "https://tramites.bcs.gob.mx/todos-los-tramites-y-servicios/", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se localizaron el aviso fiscal de revista vehicular 2026 y el catálogo de trámites. Revista vehicular no se equipara automáticamente con verificación ambiental. Confirmar requisitos, prórrogas y vigencia documental; revisión legal integral pendiente.",
  },
  "Chihuahua": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Hacienda · Trámites de revalidación vehicular 2026", url: "https://tramites.chihuahua.gob.mx/buscador.aspx?tram=revalidacion+vehicular+2026", topic: "vehicle_control", kind: "official_portal" },
      { title: "Municipio de Juárez · Referencia de engomado ecológico (2025)", url: "https://www.juarez.gob.mx/noticia/26757/invita-seguridad-vial-a-tramitar-engomado-ecolA3gico-para-evitar-multas", topic: "verification", kind: "official_portal" },
    ],
    note: "Se revisó la revalidación estatal 2026. La referencia ambiental de Juárez es municipal y de 2025: no acredita una regla uniforme para Chihuahua ni un calendario 2026. Confirmar municipio de operación y disposición vigente; revisión legal integral pendiente.",
  },
  "Coahuila": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Administración Fiscal General · PagaFácil, control vehicular", url: "https://app.pagafacil.gob.mx/pagafacilv2/v2app.php", topic: "vehicle_control", kind: "official_portal" },
      { title: "Torreón · Trámite municipal de verificación de emisiones", url: "https://www.torreon.gob.mx/InfoTramite.php?dependencia=03252609-e31e-11ea-bebf-0050569888fd&tramite=d352c3fc-eda1-11ea-b289-0050569888fd", topic: "verification", kind: "official_portal" },
    ],
    note: "Se revisaron PagaFácil y la ficha de verificación de Torreón. La ficha municipal no debe extenderse a todo Coahuila; falta confirmar programa, calendario y municipio aplicables. Referencias oficiales, no dictamen de cumplimiento.",
  },
  "Durango": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Finanzas · Pagos vehiculares: replaqueo y refrendo", url: "https://www.pagos.durango.gob.mx/vehicular/", topic: "vehicle_control", kind: "official_portal" },
      { title: "Gobierno de Durango · Ficha de refrendo anual particular", url: "https://www.durango.gob.mx/tramites-y-servicios/despacho_del_ejecutivo_del_estado/secretaria_de_finanzas__y_de_administracion/refrendo_anual_automoviles_camiones_autobuses_motocicletas_motonetas_y_similares_para_uso_particular", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisaron el portal de pagos y la ficha de refrendo. Falta validar normativa ambiental y de circulación según municipio y uso. No se concluye que exista exención de verificación; confirmar vigencia y trámite antes de registrar fechas.",
  },
  "Nuevo León": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "ICV · Refrendo, registro vehicular y ventanilla empresarial", url: "https://www.icvnl.gob.mx/", topic: "vehicle_control", kind: "official_portal" },
      { title: "ICV · Normatividad y transparencia", url: "https://www.icvnl.gob.mx/Transparencia", topic: "legislation", kind: "official_portal" },
    ],
    note: "Se revisaron los accesos oficiales del ICV a refrendo y normativa. No se validó un calendario ambiental ni las restricciones de cada municipio. Confirmar documentos, tipo de servicio y disposiciones vigentes; revisión legal integral pendiente.",
  },
  "San Luis Potosí": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Finanzas · Control vehicular y requisitos", url: "https://finanzas.slp.gob.mx/control-vehicular/", topic: "vehicle_control", kind: "official_portal" },
      { title: "Finanzas · Información de control vehicular y tarjeta para 2026", url: "https://finanzas.slp.gob.mx/noticias/2026/1/3/reduce-costo-del-control-vehicular-en-2026/", topic: "circulation", kind: "official_portal" },
    ],
    note: "Se contrastaron el portal de trámites y el aviso 2026 sobre vigencia de tarjetas. El portal también conserva apartados de ejercicios anteriores; no usar sus importes o fechas como reglas actuales sin confirmación. Revisión legal integral pendiente.",
  },
  "Sinaloa": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Atención Ciudadana · Trámites vehiculares presenciales", url: "https://atencionciudadana.sinaloa.gob.mx/tramites-presenciales/", topic: "vehicle_control", kind: "official_portal" },
      { title: "Gobierno de Sinaloa · Prórroga de refrendo 2026", url: "https://sinaloa.gob.mx/autoriza-gobernador-rocha-prorroga-de-dos-semanas-para-que-contribuyentes-cubran-adeudos-de-calcas-o-refrendos/", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisaron requisitos y un aviso oficial de prórroga de 2026, por lo que no se presupone un vencimiento anual fijo. Confirmar adeudos, prórrogas posteriores y condiciones del vehículo; revisión legal y ambiental integral pendiente.",
  },
  "Sonora": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Hacienda · Padrón vehicular y revalidación", url: "https://hacienda.sonora.gob.mx/contribuyentes/padron-vehicular", topic: "vehicle_control", kind: "official_portal" },
      { title: "Boletín Oficial · Procedimientos de revalidación, 2 de marzo de 2026", url: "https://boletinoficial.sonora.gob.mx/boletin.php?id=258", topic: "legislation", kind: "official_portal" },
    ],
    note: "Se localizaron requisitos de revalidación y su referencia en el Boletín Oficial. Deben confirmarse el expediente de la empresa, documentos vigentes y reglas locales de operación. No se realizó una validación legal exhaustiva ni se asignan fechas automáticas.",
  },
  "Tamaulipas": {
    reviewedOn: "2026-09-30",
    sources: [
      { title: "Finanzas · Pago de derechos de control vehicular y tenencia", url: "https://finanzas.tamaulipas.gob.mx/pago-de-contribuciones/control-vehicular/iniciar-tramite.php", topic: "vehicle_control", kind: "official_portal" },
      { title: "Finanzas · Requisitos de envío de documentos vehiculares 2026", url: "https://finanzas.tamaulipas.gob.mx/uploads/2025/01/informacion-fiscal/CONTROL_VEHICULAR_-_PAGO_CON_ENVIO_DERECHOS_DE_CONTROL_VEHICULAR_2026_A_PARTIR_DE_FEBRERO.pdf", topic: "vehicle_control", kind: "official_portal" },
    ],
    note: "Se revisaron el trámite oficial y los requisitos de documentos para personas físicas y morales. Subsidios, plazos y obligaciones ambientales o de circulación requieren confirmación individual. Referencias oficiales, no dictamen de cumplimiento.",
  },
};

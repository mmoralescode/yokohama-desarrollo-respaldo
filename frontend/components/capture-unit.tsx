"use client";
import {useEffect, useState} from "react";
import {useResource} from "@/lib/api";
import type {VehicleDetail, VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Loading} from "./ui";

export function useCaptureUnit() {
  const fleet = useResource<VehicleSummary[]>("vehicles");
  const [unit, setUnit] = useState("");
  useEffect(() => {const value = new URLSearchParams(window.location.search).get("unidad"); if (value && /^[1-9]\d*$/.test(value)) setUnit(value);}, []);
  useEffect(() => {if (!unit && fleet.data?.length === 1) setUnit(String(fleet.data[0].id));}, [fleet.data, unit]);
  const selected = fleet.data?.find(vehicle => String(vehicle.id) === unit);
  const detail = useResource<VehicleDetail>(`vehicles/${selected?.id || 0}`, !!selected);
  // Never render one unit's stale form while a different unit is loading.
  const resolvedDetail = {...detail, data: detail.data?.vehicle.id === selected?.id ? detail.data : null};
  return {fleet, unit, setUnit, selected, detail: resolvedDetail, refresh: () => {detail.refresh(); fleet.refresh();}};
}
export function CaptureUnitPicker({state}: {state: ReturnType<typeof useCaptureUnit>}) {
  const {fleet, unit, setUnit} = state;
  if (fleet.loading && !fleet.data) return <Loading label="Cargando tus unidades…"/>;
  if (fleet.error) return <ErrorBox message={fleet.error} retry={fleet.refresh}/>;
  if (!fleet.data?.length) return <Empty title="Sin unidades asignadas">El administrador debe asignar una unidad a tu cuenta.</Empty>;
  return <section className="panel"><div className="panel-body"><label>Unidad del registro<select value={unit} onChange={event => setUnit(event.target.value)}><option value="">Selecciona placa o apodo</option>{fleet.data.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}{vehicle.nickname ? ` · ${vehicle.nickname}` : ""} · {vehicle.make} {vehicle.model}</option>)}</select></label></div></section>;
}

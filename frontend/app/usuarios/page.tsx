"use client";
import Link from "next/link";
import {useEffect, useState, type FormEvent} from "react";
import {api} from "@/lib/api";
import {DEVELOPER_EMAIL, isAdministratorEmail, OWNER_EMAIL, useAuth, type CompanyUser} from "@/lib/auth-context";
import type {VehicleSummary} from "@/lib/types";
import {normalizeSearch} from "@/lib/drivers";
import {Empty, ErrorBox, Icon, Loading, PageHeader} from "@/components/ui";
import {ProgressiveList} from "@/components/disclosure";
import {AddVehicle} from "@/components/add-vehicle";

export default function UsersPage() {
  const auth = useAuth();
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<CompanyUser | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [passwordProvided, setPasswordProvided] = useState(false);
  const [createdUser, setCreatedUser] = useState<CompanyUser | null>(null);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  useEffect(() => {
    if (!auth.configured || !auth.isAdmin || auth.proposal) {setLoading(false); return;}
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    Promise.all([api<CompanyUser[]>("users", {signal: controller.signal}), api<VehicleSummary[]>("vehicles", {signal: controller.signal})]).then(([people, fleet]) => {if (!controller.signal.aborted) {setUsers(people); setVehicles(fleet);}}).catch(reason => {if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "No se pudieron consultar los usuarios.");}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [auth.configured, auth.isAdmin, auth.proposal, revision]);
  function closeForm() {setShowForm(false); setEditing(null); setSelected([]); setQuery(""); setPasswordProvided(false); setError(null); setFormVersion(value => value + 1);}
  function begin(user: CompanyUser | null) {setCreatedUser(null); setShowVehicleForm(false); setEditing(user); setShowForm(true); setSelected(user?.vehicle_ids || []); setQuery(""); setPasswordProvided(false); setError(null); setNotice(null); setFormVersion(value => value + 1);}
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") || "");
    const confirmation = String(fields.get("passwordConfirmation") || "");
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden. Escríbelas igual en ambos campos.");
      (event.currentTarget.elements.namedItem("passwordConfirmation") as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const saved = await api<CompanyUser>(editing ? `users/${editing.id}` : "users", {method: editing ? "PATCH" : "POST", body: {name: fields.get("name"), email: fields.get("email"), role: "user", vehicle_ids: selected, ...(password ? {password} : {}), ...(editing ? {active: fields.get("active") === "on"} : {})}});
      setNotice(editing ? "Cambios guardados. Si cambiaste las unidades o la contraseña, el conductor deberá iniciar sesión nuevamente." : "Usuario creado. Comparte la contraseña inicial por un canal privado; puede cambiarla en Mi cuenta.");
      if (!editing) setCreatedUser(saved);
      closeForm(); setRevision(value => value + 1);
    } catch (reason) {setError(reason instanceof Error ? reason.message : "No se pudo guardar la cuenta.");}
    finally {setBusy(false);}
  }
  if (auth.proposal) return <><PageHeader title="Usuarios"/><section className="panel account-section"><h2>Agregar usuario</h2><p className="account-hint">El alta de cuentas requiere conectar el servidor privado de la empresa.</p></section></>;
  if (!auth.isAdmin) return <Empty title="Apartado del administrador">Solicita al administrador cualquier cambio en tu cuenta o asignación.</Empty>;
  const filtered = vehicles.filter(vehicle => normalizeSearch(`${vehicle.plate} ${vehicle.nickname || ""} ${vehicle.make} ${vehicle.model}`).includes(normalizeSearch(query)));
  const drivers = users.filter(user => user.role === "user" && normalizeSearch(`${user.name} ${user.email}`).includes(normalizeSearch(peopleQuery)));
  const administrators = users.filter(user => user.role === "admin" && isAdministratorEmail(user.email));
  return <><PageHeader eyebrow="EQUIPO DE LA EMPRESA" title="Usuarios" description="Crea su acceso y elige exactamente qué unidades podrá consultar." action={<button className="button primary" disabled={loading || busy} onClick={() => begin(null)}><Icon name="plus" size={17}/>Agregar usuario</button>}/>{notice && <p role="status" className="message success">{notice}</p>}{loadError && <ErrorBox message={loadError} retry={() => setRevision(value => value + 1)}/>}
    {showForm && <section className="panel account-section account-form">
      <div className="inline between gap"><h2>{editing ? `Editar a ${editing.name}` : "Nuevo usuario"}</h2><button type="button" className="text-button" disabled={busy} onClick={closeForm}>Cerrar</button></div>
      <form key={formVersion} onSubmit={save}><fieldset disabled={busy || loading || !!loadError}>
        <label>Nombre completo<input name="name" required minLength={2} maxLength={100} autoComplete="name" defaultValue={editing?.name || ""}/></label>
        <label>Correo de acceso<input name="email" type="email" required maxLength={254} autoComplete="off" defaultValue={editing?.email || ""}/></label>
        <label>{editing ? "Nueva contraseña (opcional)" : "Contraseña inicial"}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required={!editing} onChange={event => setPasswordProvided(event.target.value.length > 0)}/></label>
        <label>{editing ? "Confirmar nueva contraseña" : "Confirmar contraseña"}<input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required={!editing || passwordProvided}/></label>
        <p className="account-hint">Mínimo 12 caracteres. La contraseña anterior nunca se muestra.</p>
        <label>Buscar unidades para asignar<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Placa o apodo"/></label>
        <p className="account-hint">{selected.length} seleccionadas. Sin una asignación no verá unidades.</p>
        <div className="account-assignment" role="group" aria-label="Unidades asignadas">{filtered.map(vehicle => <label key={vehicle.id}><input type="checkbox" checked={selected.includes(vehicle.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, vehicle.id] : previous.filter(id => id !== vehicle.id))}/><span><strong>{vehicle.plate}</strong>{vehicle.nickname ? ` · ${vehicle.nickname}` : ""}<br/><span className="muted small">{vehicle.make} {vehicle.model}</span></span></label>)}{!filtered.length && <p className="account-hint">Sin coincidencias.</p>}</div>
        {editing && <label className="account-inline-check"><input name="active" type="checkbox" defaultChecked={editing.active}/>Cuenta activa</label>}
        <div className="account-actions"><button type="submit" className="button primary">{busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear usuario"}</button><button type="button" className="button secondary" disabled={busy} onClick={closeForm}>Cancelar</button></div>
      </fieldset></form>{error && <ErrorBox message={error}/>}
    </section>}
    {createdUser && <section className="panel account-section" aria-label="Unidad del usuario creado">
      <div className="inline between gap"><h2>{createdUser.name}</h2><button type="button" className="text-button" onClick={() => {setCreatedUser(null); setShowVehicleForm(false);}}>Cerrar</button></div>
      <p className="small muted">{createdUser.email}</p>
      {!showVehicleForm && <button type="button" className="button primary" disabled={loading || !!loadError} onClick={() => setShowVehicleForm(true)}><Icon name="plus" size={17}/>Cargar unidad</button>}
      {showVehicleForm && <AddVehicle assignedUser={{id: createdUser.id, name: createdUser.name}} onDone={() => {setShowVehicleForm(false); setNotice(`Unidad registrada y asignada a ${createdUser.name}.`); setRevision(value => value + 1);}}/>}
    </section>}
    <section className="panel account-section"><div className="inline between gap"><h2>Equipo registrado</h2><button type="button" className="button secondary small-button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={17}/>Actualizar</button></div><label>Buscar usuario<input value={peopleQuery} onChange={event => setPeopleQuery(event.target.value)} placeholder="Nombre o correo"/></label>{loading && !users.length ? <Loading label="Consultando equipo…"/> : drivers.length ? <ProgressiveList key={peopleQuery} items={drivers} label="usuarios" className="account-list" render={user => <article className="account-row" key={user.id}><div><strong>{user.name}</strong><p className="small muted">{user.email}</p><span className="badge neutral">{user.vehicle_ids.length} unidades</span>{!user.active && <span className="badge severity-importante">Inactivo</span>}<details className="account-record-more"><summary>Mostrar más</summary><ul>{user.vehicle_ids.map(id => <li key={id}><Link href={`/vehiculos/${id}`}>{vehicles.find(vehicle => vehicle.id === id)?.plate || `Unidad ${id}`}</Link></li>)}</ul>{!user.vehicle_ids.length && <p className="small muted">No tiene unidades asignadas.</p>}</details></div><button type="button" className="button secondary small-button" disabled={busy} onClick={() => begin(user)} aria-label={`Editar cuenta de ${user.name}`}>Editar</button></article>}/> : <Empty title={peopleQuery ? "Sin coincidencias" : "Aún no hay usuarios"}>Agrega un usuario y asigna sus unidades.</Empty>}
      <p className="account-hint" aria-label="Cuentas administradoras">Administradores: {administrators.length ? administrators.map(user => `${user.email}${user.email.trim().toLowerCase() === DEVELOPER_EMAIL ? " (desarrollador)" : ""}${!user.active ? " (inactivo)" : ""}`).join(" · ") : OWNER_EMAIL}. Cada administrador cambia su contraseña desde Mi cuenta.</p>
    </section></>;
}

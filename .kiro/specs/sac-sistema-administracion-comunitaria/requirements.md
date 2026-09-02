# Requirements Document

## Introduction

SAC (Sistema de Administración Comunitaria) es una plataforma multi-tenant (multi-comité) para administrar las operaciones financieras y organizativas de comités de ayuda comunitaria. El sistema centraliza ingresos, egresos, aportaciones voluntarias, donaciones, actividades, cortes de caja, miembros, usuarios, comprobantes y un sistema anual de bonos con beneficiarios, vendedores, cobros, entregas, sorteos y premios.

La fuente de verdad financiera es un ledger de movimientos inmutable/reversable, no un saldo editable. El aislamiento de datos entre comités se aplica por `committee_id` mediante Row Level Security (RLS) y control de acceso basado en roles (RBAC). La primera versión será una PWA responsiva usable desde Android, iPhone, tablet y computadora.

Este documento deriva los requerimientos formales en formato EARS del documento fuente autoritativo: #[[file:SAC_requerimientos_diseno_tecnico.md]]

## Glossary

- **SAC**: Sistema de Administración Comunitaria; la plataforma completa objeto de este documento.
- **Committee_Service**: Componente que gestiona la creación, configuración y aislamiento de comités (tenants).
- **Auth_Service**: Componente que gestiona autenticación, sesiones y recuperación de contraseña.
- **Authorization_Service**: Componente que evalúa permisos RBAC y membresía a comité antes de autorizar operaciones.
- **Member_Service**: Componente que gestiona el registro y estado de los miembros del comité.
- **Account_Service**: Componente que gestiona cuentas y cajas financieras.
- **Ledger_Service**: Componente que registra apuntes financieros inmutables/reversables y deriva saldos.
- **Transaction_Service**: Componente que gestiona transacciones financieras (ingresos, egresos, transferencias, ajustes) y sus estados.
- **Attachment_Service**: Componente que gestiona el almacenamiento y entrega de comprobantes.
- **Contribution_Service**: Componente que gestiona aportaciones voluntarias.
- **Donation_Service**: Componente que gestiona donaciones monetarias y en especie.
- **Activity_Service**: Componente que gestiona actividades y sus cortes.
- **Cash_Closing_Service**: Componente que gestiona los cortes mensuales de caja.
- **Bonus_Campaign_Service**: Componente que gestiona campañas anuales de bonos, números y beneficiarios.
- **Bonus_Collection_Service**: Componente que gestiona mensualidades y cobros de bonos.
- **Bonus_Settlement_Service**: Componente que gestiona las entregas de vendedores y su confirmación por tesorería.
- **Bonus_Draw_Service**: Componente que gestiona sorteos y pago de premios.
- **Report_Service**: Componente que genera reportes y exportaciones.
- **Dashboard_Service**: Componente que calcula y muestra indicadores agregados.
- **Seller_Portal**: Interfaz mobile-first para vendedores de bonos.
- **Audit_Service**: Componente que registra eventos de auditoría inmutables.
- **Committee (comité)**: Tenant propietario de un conjunto aislado de datos; identificado por `committee_id`.
- **Ledger (ledger de movimientos)**: Conjunto de apuntes financieros que constituye la fuente de verdad del saldo.
- **Ledger_Entry (apunte)**: Registro individual de crédito o débito contra una cuenta, vinculado a una transacción.
- **Financial_Transaction**: Operación financiera que agrupa uno o más apuntes de ledger.
- **Derived_Balance (saldo derivado)**: Saldo calculado a partir de la suma de apuntes del ledger de una cuenta.
- **Monthly_Due (mensualidad)**: Obligación de aportación de un número de bono para un periodo.
- **Collection (cobro)**: Registro de dinero cobrado por un vendedor a un beneficiario.
- **Settlement (entrega)**: Agrupación de cobros que un vendedor reporta y tesorería confirma.
- **Draw (sorteo)**: Evento que determina el número ganador de un periodo de campaña.
- **Prize_Payment (pago de premio)**: Egreso generado al pagar el premio de un sorteo.
- **Posted_Transaction (movimiento contabilizado)**: Transacción financiera en estado aprobado/contabilizado incorporada al ledger.
- **RBAC**: Control de acceso basado en roles compuestos por permisos granulares.
- **RLS**: Row Level Security de PostgreSQL que restringe filas por `committee_id`.
- **Signed_URL (URL firmada)**: Enlace temporal de duración limitada para acceder a un comprobante en bucket privado.

## Requirements

### Requirement 1: Creación y administración de comités (RF-001)

**User Story:** Como superadministrador de plataforma, quiero crear y configurar comités, para que cada organización comunitaria administre sus operaciones de forma independiente.

#### Acceptance Criteria

1. WHEN un superadministrador envía datos válidos de un comité, THE Committee_Service SHALL crear el comité con nombre, logo, localidad, teléfono, correo, responsables, configuración financiera, configuración de bonos y estado.
2. IF el nombre del comité está vacío, THEN THE Committee_Service SHALL rechazar la creación y devolver un mensaje de validación.
3. WHEN se crea un comité, THE Committee_Service SHALL asignar un identificador único `committee_id` al comité.
4. WHEN un administrador modifica el estado de un comité, THE Committee_Service SHALL registrar el nuevo estado y el usuario que realizó el cambio.

### Requirement 2: Aislamiento de información multi-tenant (RF-002)

**User Story:** Como responsable de un comité, quiero que los datos de mi comité estén aislados de otros comités, para que ninguna persona ajena acceda a información sensible.

#### Acceptance Criteria

1. THE SAC SHALL asociar cada registro operativo propiedad de un comité (miembros, cuentas, transacciones financieras, apuntes del ledger, aportaciones, donaciones, actividades, cortes, bonos y sus entidades relacionadas) con exactamente un `committee_id` no nulo.
2. WHEN un usuario solicita datos de un comité al que no tiene una membresía activa, THE Authorization_Service SHALL denegar el acceso mediante RLS y validación de servidor, no retornar ningún registro del comité no autorizado, y no revelar la existencia ni el conteo de dichos registros.
3. IF un usuario intenta escribir, actualizar o eliminar un registro cuyo `committee_id` no corresponde a un comité con membresía activa del usuario, THEN THE Authorization_Service SHALL rechazar la operación, no aplicar ningún cambio al almacén de datos, y retornar una indicación de error de autorización a quien invoca.
4. THE Authorization_Service SHALL considerar autorizado el acceso de un usuario a un comité únicamente cuando exista un registro en `committee_users` que vincule al usuario con ese `committee_id` y cuyo estado sea `active`.
5. WHEN se rechaza un intento de acceso o escritura de un usuario sobre un `committee_id` sin membresía activa, THE Authorization_Service SHALL registrar el intento en el registro de auditoría con el usuario, la fecha/hora y el `committee_id` objetivo.
6. WHERE el usuario tiene el rol Superadministrador, THE Authorization_Service SHALL permitir el acceso administrativo a todos los comités sin requerir una membresía activa por comité.

### Requirement 3: Configuración por comité (RF-003)

**User Story:** Como administrador de un comité, quiero configurar categorías, cuentas, reglas de bonos, roles y parámetros, para que la operación se adapte a mi comité sin afectar a otros.

#### Acceptance Criteria

1. WHEN un administrador de comité autenticado con permiso `committee.manage` modifica categorías, cuentas, reglas de bonos, roles o parámetros operativos, THE Committee_Service SHALL aplicar los cambios únicamente a los registros cuyo `committee_id` coincida con el `committee_id` del administrador que realiza la operación.
2. WHEN un administrador de un comité confirma una modificación de su configuración, THE Committee_Service SHALL preservar sin ningún cambio la configuración de todos los demás comités (aquellos con un `committee_id` distinto al del administrador).
3. IF un usuario intenta modificar la configuración de un comité al que no pertenece o para el que no posee el permiso `committee.manage`, THEN THE Committee_Service SHALL rechazar la operación, no aplicar ningún cambio a ningún comité, y devolver un mensaje de error indicando acceso no autorizado.
4. IF una modificación de configuración incluye un valor inválido (por ejemplo, un nombre de categoría, cuenta o rol vacío o que exceda 120 caracteres, o un parámetro numérico fuera de sus límites definidos), THEN THE Committee_Service SHALL rechazar la operación completa, preservar la configuración previa del comité sin cambios, y devolver un mensaje de error indicando el campo inválido.

### Requirement 4: Autenticación y sesiones (RF-010)

**User Story:** Como usuario del sistema, quiero iniciar y cerrar sesión y recuperar mi contraseña, para acceder de forma segura a las funciones autorizadas.

#### Acceptance Criteria

1. WHEN un usuario envía un correo con formato válido y la contraseña correspondiente a una cuenta con estado activo, THE Auth_Service SHALL establecer una sesión autenticada y devolver una confirmación de acceso al usuario en 3 segundos o menos.
2. IF un usuario envía credenciales inválidas o corresponde a una cuenta con estado inactivo, THEN THE Auth_Service SHALL denegar el acceso, no establecer sesión y devolver un mensaje de error de autenticación que no revele si el correo está registrado.
3. IF un usuario acumula 5 intentos de inicio de sesión fallidos consecutivos para el mismo correo dentro de 15 minutos, THEN THE Auth_Service SHALL bloquear nuevos intentos para ese correo durante 15 minutos y devolver un mensaje de error indicando bloqueo temporal.
4. WHEN un usuario solicita recuperación de contraseña con un correo registrado, THE Auth_Service SHALL iniciar el flujo de restablecimiento y generar un enlace de restablecimiento con validez máxima de 60 minutos.
5. IF un usuario solicita recuperación de contraseña con un correo no registrado, THEN THE Auth_Service SHALL responder con el mismo mensaje de confirmación genérico que en el caso registrado, sin revelar si el correo existe.
6. WHEN un usuario solicita cerrar sesión, THE Auth_Service SHALL invalidar la sesión activa del usuario y devolver una confirmación de cierre de sesión.
7. WHILE una sesión autenticada permanece inactiva durante 30 minutos continuos, THE Auth_Service SHALL invalidar la sesión y requerir una nueva autenticación en la siguiente solicitud.
8. WHERE un usuario pertenece a más de un comité, THE SAC SHALL requerir la selección de un comité activo tras la autenticación antes de permitir acceso a funciones del comité.
9. WHERE un usuario pertenece a exactamente un comité, THE SAC SHALL seleccionar automáticamente ese comité como activo tras la autenticación sin solicitar selección.

### Requirement 5: Roles iniciales (RF-011)

**User Story:** Como administrador de comité, quiero asignar roles predefinidos a los usuarios, para delimitar las funciones de cada persona.

#### Acceptance Criteria

1. THE Authorization_Service SHALL ofrecer exactamente los nueve roles predefinidos: superadministrador, administrador del comité, presidente, tesorero, secretario, capturista, vendedor de bonos, auditor y miembro.
2. WHEN un administrador asigna uno de los nueve roles predefinidos a un usuario que es miembro activo de un comité, THE Authorization_Service SHALL registrar la asignación de rol vinculada al `committee_id` correspondiente.
3. IF un administrador intenta asignar un rol que no pertenece a la lista de nueve roles predefinidos, THEN THE Authorization_Service SHALL rechazar la asignación, no registrar ningún cambio y devolver un mensaje que indique que el rol no es válido.
4. IF un administrador intenta asignar un rol a un usuario que no es miembro activo del comité indicado, THEN THE Authorization_Service SHALL rechazar la asignación, no registrar ningún cambio y devolver un mensaje que indique que el usuario no es miembro del comité.
5. WHERE un usuario tiene el rol auditor en un comité, THE Authorization_Service SHALL conceder acceso de solo lectura a los registros del comité, incluidos los registros de auditoría, limitado al `committee_id` de dicho comité.
6. IF un usuario con rol auditor intenta cualquier operación de creación, modificación o eliminación, THEN THE Authorization_Service SHALL rechazar la operación sin alterar los datos.

### Requirement 6: RBAC granular (RF-012)

**User Story:** Como administrador de comité, quiero que los permisos sean granulares y agrupados en roles, para autorizar operaciones con el mínimo privilegio.

#### Acceptance Criteria

1. THE Authorization_Service SHALL evaluar permisos granulares que incluyen members.read, members.create, members.update, transactions.read, transactions.create, transactions.approve, transactions.void, cash_closings.create, cash_closings.review, cash_closings.close, bonuses.read, bonuses.collect, bonuses.settle, bonuses.draw, reports.read, users.manage, committee.manage y audit.read.
2. WHEN un usuario intenta una operación sin el permiso requerido, THE Authorization_Service SHALL denegar la operación y devolver un error de autorización.
3. THE Authorization_Service SHALL derivar los permisos efectivos de un usuario de la unión de los permisos de los roles asignados en el comité activo.

### Requirement 7: Registro de miembros (RF-020)

**User Story:** Como secretario, quiero registrar miembros del comité, para mantener el padrón organizativo actualizado.

#### Acceptance Criteria

1. WHEN un usuario con permiso members.create envía datos de un miembro con nombre no vacío de entre 1 y 150 caracteres y estado dentro del conjunto activo, inactivo o baja, THE Member_Service SHALL registrar el miembro con nombre, teléfono, fecha de incorporación, cargo, estado y notas, asociándolo al comité del usuario.
2. WHEN se registra un miembro nuevo sin especificar estado, THE Member_Service SHALL asignar el estado inicial activo.
3. IF el nombre del miembro está vacío o excede 150 caracteres, THEN THE Member_Service SHALL rechazar el registro, conservar los datos capturados sin persistirlos y devolver un mensaje de validación que indique el problema del nombre.
4. IF el estado enviado no pertenece al conjunto activo, inactivo o baja, THEN THE Member_Service SHALL rechazar el registro, conservar los datos capturados sin persistirlos y devolver un mensaje de validación que indique que el estado es inválido.
5. IF el teléfono excede 30 caracteres o las notas exceden 500 caracteres, THEN THE Member_Service SHALL rechazar el registro, conservar los datos capturados sin persistirlos y devolver un mensaje de validación que indique el campo excedido.

### Requirement 8: Separación miembro/usuario (RF-021)

**User Story:** Como administrador, quiero separar el concepto de miembro del de usuario de acceso, para registrar miembros sin obligarlos a tener credenciales.

#### Acceptance Criteria

1. THE Member_Service SHALL permitir registrar un miembro sin una cuenta de acceso asociada.
2. WHERE un usuario se vincula con un miembro, THE Member_Service SHALL asociar como máximo un miembro por usuario dentro del comité.

### Requirement 9: Cuentas y cajas financieras (RF-030)

**User Story:** Como tesorero, quiero administrar cuentas y cajas, para organizar el dinero del comité por origen y destino.

#### Acceptance Criteria

1. WHEN un usuario con el permiso `committee.manage` crea una cuenta proporcionando un nombre de hasta 80 caracteres (único dentro del comité) y un tipo dentro del conjunto {caja general, cuenta bancaria, caja de actividad, cuenta digital, otra}, THE Account_Service SHALL registrar la cuenta con estado activa, asociada al comité del usuario, y confirmar la creación en un máximo de 2 segundos.
2. IF el usuario intenta crear una cuenta sin nombre, con un nombre que exceda 80 caracteres, con un nombre duplicado dentro del mismo comité, o con un tipo fuera del conjunto permitido, THEN THE Account_Service SHALL rechazar la operación indicando el motivo del error sin crear la cuenta.
3. WHEN un usuario con el permiso `committee.manage` desactiva una cuenta, THE Account_Service SHALL marcar la cuenta como inactiva conservando íntegramente su historial de apuntes en el ledger.
4. IF un usuario intenta registrar un ingreso, egreso o transferencia contra una cuenta inactiva, THEN THE Account_Service SHALL rechazar la operación indicando que la cuenta se encuentra inactiva.

### Requirement 10: Saldo derivado del ledger (RF-031)

**User Story:** Como tesorero, quiero que el saldo se calcule a partir del ledger, para que el saldo sea verificable y no manipulable.

#### Acceptance Criteria

1. THE Ledger_Service SHALL calcular el Derived_Balance de una cuenta como la suma del saldo inicial más los apuntes de ledger asociados a la cuenta.
2. THE Account_Service SHALL rechazar cualquier operación que intente asignar directamente un valor de saldo a una cuenta.
3. WHEN se agrega un apunte de ledger a una cuenta, THE Ledger_Service SHALL reflejar el apunte en el Derived_Balance de la cuenta.

### Requirement 11: Transferencias internas (RF-032)

**User Story:** Como tesorero, quiero transferir dinero entre cuentas del mismo comité, para mover fondos sin distorsionar ingresos ni egresos.

#### Acceptance Criteria

1. WHEN un usuario con permiso transactions.create registra una transferencia entre dos cuentas distintas del mismo comité con un monto entre 0.01 y 999,999,999.99, THE Transaction_Service SHALL generar de forma atómica dos apuntes de ledger relacionados: una salida en la cuenta origen y una entrada en la cuenta destino, de modo que ambos apuntes se persistan o ninguno se persista.
2. THE Ledger_Service SHALL mantener en cero la suma de los apuntes de ledger de una transferencia.
3. THE Transaction_Service SHALL registrar toda transferencia entre dos cuentas del mismo comité sin generar ningún apunte de ingreso ni de egreso económico neto para el comité.
4. IF el usuario que registra la transferencia no tiene el permiso transactions.create, THEN THE Transaction_Service SHALL rechazar la operación, no generar ningún apunte de ledger, y devolver un error indicando falta de permiso.
5. IF la cuenta origen y la cuenta destino son la misma cuenta, o alguna de las dos cuentas no pertenece al mismo comité, THEN THE Transaction_Service SHALL rechazar la transferencia, no generar ningún apunte de ledger, y devolver un error indicando cuentas inválidas.
6. IF el monto de la transferencia es menor a 0.01, mayor a 999,999,999.99, o excede el saldo calculado de la cuenta origen, THEN THE Transaction_Service SHALL rechazar la transferencia, no generar ningún apunte de ledger, y devolver un error indicando monto inválido o saldo insuficiente.

### Requirement 12: Registrar ingreso (RF-040)

**User Story:** Como tesorero o capturista, quiero registrar ingresos, para dejar constancia del dinero recibido por el comité.

#### Acceptance Criteria

1. WHEN un usuario con permiso transactions.create envía un ingreso con fecha efectiva, monto mayor a 0 y con un máximo de dos decimales dentro del rango de 0.01 a 999,999,999,999.99, categoría, concepto, origen, método de pago y cuenta receptora activa del mismo comité, THE Transaction_Service SHALL registrar la transacción de tipo ingreso y devolver el identificador de la transacción creada en un máximo de 5 segundos.
2. IF el monto de un ingreso es menor o igual a 0, tiene más de dos decimales o excede 999,999,999,999.99, THEN THE Transaction_Service SHALL rechazar el registro, no crear ninguna transacción ni apunte de ledger, y devolver un mensaje de validación indicando el rango de monto permitido.
3. IF un usuario sin el permiso transactions.create envía un ingreso, THEN THE Transaction_Service SHALL rechazar la solicitud, no crear ninguna transacción, y devolver un mensaje indicando falta de autorización.
4. IF la cuenta receptora indicada está inactiva, no existe o pertenece a otro comité, THEN THE Transaction_Service SHALL rechazar el registro, no crear ninguna transacción ni apunte de ledger, y devolver un mensaje de validación indicando que la cuenta receptora no es válida.
5. WHEN se contabiliza un ingreso, THE Ledger_Service SHALL crear un apunte de ledger con monto positivo igual al monto del ingreso en la cuenta receptora indicada.
6. WHEN se registra un ingreso, THE Transaction_Service SHALL registrar el identificador del usuario creador y la fecha/hora de captura con precisión de segundos asociados a la transacción.

### Requirement 13: Categorías configurables (RF-041)

**User Story:** Como administrador de comité, quiero administrar categorías de ingresos, para clasificar el dinero según mi comité.

#### Acceptance Criteria

1. WHEN un administrador de comité crea, renombra o elimina una categoría, THE Transaction_Service SHALL aplicar el cambio únicamente al catálogo del comité al que pertenece el administrador, sin modificar el catálogo de ningún otro comité.
2. WHEN se crea un nuevo comité, THE Transaction_Service SHALL asignarle automáticamente las categorías iniciales: aportaciones, donaciones, bonos, actividades, ventas, cooperación extraordinaria y otros.
3. IF un administrador de comité intenta crear o renombrar una categoría y ya existe otra categoría con el mismo nombre dentro del mismo comité, THEN THE Transaction_Service SHALL rechazar la operación y presentar un mensaje de error indicando que el nombre de categoría ya existe.
4. IF un administrador de comité intenta eliminar una categoría que está asociada a al menos un ingreso registrado, THEN THE Transaction_Service SHALL rechazar la eliminación y presentar un mensaje de error indicando que la categoría tiene ingresos asociados.
5. WHEN un administrador de comité crea o renombra una categoría, THE Transaction_Service SHALL validar que el nombre tenga entre 1 y 100 caracteres y no esté compuesto únicamente de espacios en blanco; de lo contrario SHALL rechazar la operación e indicar el motivo del rechazo.

### Requirement 14: Registrar egreso (RF-050)

**User Story:** Como tesorero, quiero registrar egresos, para dejar constancia del dinero pagado por el comité.

#### Acceptance Criteria

1. WHEN un usuario con permiso transactions.create envía un egreso con fecha efectiva, monto entre 0.01 y 999,999,999.99, beneficiario, concepto, categoría, método de pago y cuenta de origen, THE Transaction_Service SHALL registrar la transacción de tipo egreso y devolver una confirmación con el identificador de la transacción registrada en un plazo máximo de 3 segundos.
2. IF el monto de un egreso es menor o igual a cero o mayor a 999,999,999.99, THEN THE Transaction_Service SHALL rechazar el registro, no persistir ninguna transacción y devolver un mensaje de validación que indique que el monto está fuera del rango permitido.
3. IF alguno de los campos obligatorios (fecha efectiva, monto, beneficiario, concepto, categoría, método de pago o cuenta de origen) está ausente o vacío, THEN THE Transaction_Service SHALL rechazar el registro, no persistir ninguna transacción y devolver un mensaje de validación que indique el campo faltante.
4. WHEN se contabiliza un egreso, THE Ledger_Service SHALL crear un apunte de ledger negativo en la cuenta de origen por un monto igual al monto del egreso registrado.
5. IF la cuenta de origen o receptora de un movimiento está inactiva, THEN THE Transaction_Service SHALL rechazar la operación, no persistir ninguna transacción ni apunte de ledger, y devolver un mensaje de validación que indique que la cuenta está inactiva.

### Requirement 15: Estados de movimientos y anulación controlada (RF-051)

**User Story:** Como tesorero, quiero un flujo de estados y anulación controlada, para que los movimientos aprobados no se alteren silenciosamente.

#### Acceptance Criteria

1. THE Transaction_Service SHALL representar el ciclo de vida de un movimiento con los estados borrador, registrado y aprobado.
2. WHEN un usuario con permiso transactions.approve aprueba un movimiento, THE Transaction_Service SHALL transicionar el movimiento al estado aprobado y contabilizarlo en el ledger.
3. WHEN un usuario con permiso transactions.void anula un Posted_Transaction, THE Transaction_Service SHALL crear una transacción compensatoria vinculada al movimiento original en lugar de eliminarlo.
4. IF una operación intenta modificar o eliminar físicamente un Posted_Transaction, THEN THE Transaction_Service SHALL rechazar la operación.

### Requirement 16: Comprobantes en buckets privados (RF-060)

**User Story:** Como usuario, quiero adjuntar comprobantes a los movimientos, para respaldar cada operación con evidencia.

#### Acceptance Criteria

1. WHEN un usuario adjunta uno o varios archivos a un movimiento, THE Attachment_Service SHALL almacenar los archivos en un bucket privado.
2. WHEN un usuario autorizado solicita ver un comprobante, THE Attachment_Service SHALL entregar una Signed_URL de duración limitada.
3. IF una solicitud de comprobante carece de autorización sobre el comité propietario, THEN THE Attachment_Service SHALL denegar la generación de la Signed_URL.

### Requirement 17: Aportaciones voluntarias (RF-070)

**User Story:** Como secretario o tesorero, quiero registrar aportaciones voluntarias de miembros, para llevar control sin tratarlas como deuda.

#### Acceptance Criteria

1. WHEN un usuario registra una aportación con miembro, fecha, periodo, monto, método y cuenta receptora, THE Contribution_Service SHALL registrar la aportación con un estado dentro del conjunto {registrada, sin_aportacion, exento, no_aplica}.
2. IF una solicitud de registro de aportación omite alguno de los campos obligatorios (miembro, fecha, periodo, monto, método o cuenta receptora), o el monto es menor o igual a 0, THEN THE Contribution_Service SHALL rechazar el registro, no persistir la aportación y devolver un mensaje de error que indique el campo faltante o inválido.
3. THE Contribution_Service SHALL abstenerse de generar automáticamente un adeudo cuando un miembro no realiza una aportación.
4. WHEN una aportación monetaria se confirma, THE Contribution_Service SHALL vincularla con exactamente una Financial_Transaction de ingreso.
5. IF una aportación monetaria ya se encuentra vinculada a una Financial_Transaction de ingreso, THEN THE Contribution_Service SHALL rechazar cualquier intento de vinculación adicional y devolver un mensaje de error que indique doble contabilización, conservando la vinculación existente.

### Requirement 18: Donaciones monetarias y en especie (RF-080)

**User Story:** Como secretario, quiero registrar donaciones en dinero y en especie, para reflejar apoyos sin distorsionar el efectivo.

#### Acceptance Criteria

1. WHEN un usuario registra una donación, THE Donation_Service SHALL registrar el tipo dentro del conjunto {dinero, material, bien, servicio, otro} y el origen dentro del conjunto {persona, empresa, institución, anónimo}.
2. IF un usuario intenta registrar una donación cuyo tipo no pertenece al conjunto {dinero, material, bien, servicio, otro} o cuyo origen no pertenece al conjunto {persona, empresa, institución, anónimo}, THEN THE Donation_Service SHALL rechazar el registro, presentar un mensaje de error que indique el campo inválido y conservar los demás datos capturados sin persistir la donación.
3. WHEN un usuario registra una donación en especie, THE Donation_Service SHALL requerir una descripción de 1 a 500 caracteres, una cantidad numérica mayor que 0 y hasta 999,999,999.99, y un destino de 1 a 200 caracteres, y SHALL aceptar de forma opcional un valor estimado numérico entre 0.01 y 999,999,999.99.
4. IF un usuario intenta registrar una donación en especie sin descripción, sin cantidad, sin destino, o con cantidad menor o igual a 0 o mayor que 999,999,999.99, THEN THE Donation_Service SHALL rechazar el registro, presentar un mensaje de error que indique el campo faltante o fuera de rango y conservar los datos capturados sin persistir la donación.
5. WHEN se registra un valor estimado de una donación en especie, THE Donation_Service SHALL marcar ese valor con el atributo "estimado" y SHALL abstenerse de modificar el Derived_Balance de efectivo.
6. WHEN una donación monetaria se confirma, THE Donation_Service SHALL vincularla con exactamente una Financial_Transaction de tipo ingreso dentro de una única transacción de base de datos.
7. IF la creación o vinculación de la Financial_Transaction de una donación monetaria confirmada falla, THEN THE Donation_Service SHALL revertir por completo la operación, dejar la donación en estado no confirmado y presentar un mensaje de error que indique que la confirmación no se completó.

### Requirement 19: Crear actividad (RF-090)

**User Story:** Como secretario, quiero crear actividades, para organizar eventos con su propio seguimiento.

#### Acceptance Criteria

1. WHEN un usuario crea una actividad con nombre, objetivo, fechas de inicio y fin, responsable y descripción, THE Activity_Service SHALL registrar la actividad con estado inicial dentro del conjunto planeada, activa, finalizada o cerrada.
2. IF la fecha de fin de una actividad es anterior a su fecha de inicio, THEN THE Activity_Service SHALL rechazar el registro y devolver un mensaje de validación.

### Requirement 20: Movimientos asociados a actividad (RF-091)

**User Story:** Como tesorero, quiero asociar movimientos a una actividad, para calcular su resultado financiero.

#### Acceptance Criteria

1. WHEN un usuario asocia un ingreso o egreso a una actividad existente cuyo estado es `planeada`, `activa` o `finalizada`, THE Transaction_Service SHALL vincular el movimiento con el identificador de esa actividad, permitiendo como máximo una actividad asociada por movimiento.
2. IF el usuario intenta asociar un movimiento a una actividad que no existe o cuyo estado es `cerrada`, THEN THE Transaction_Service SHALL rechazar la asociación, conservar el vínculo previo del movimiento sin modificarlo y devolver un mensaje de error que indique el motivo del rechazo.
3. WHEN se solicita el resultado de una actividad, THE Activity_Service SHALL calcular dicho resultado como la suma de los montos de los ingresos en estado `aprobado` asociados a la actividad menos la suma de los montos de los egresos en estado `aprobado` asociados a la actividad, expresado con dos decimales.
4. THE Activity_Service SHALL excluir del cálculo del resultado todo movimiento que no esté en estado `aprobado`, así como los movimientos anulados mediante operación compensatoria.
5. WHEN se asocia, se desasocia, se aprueba o se anula un movimiento vinculado a una actividad, THE Activity_Service SHALL recalcular el resultado de esa actividad.

### Requirement 21: Corte de actividad (RF-092)

**User Story:** Como secretario, quiero cerrar una actividad con su corte, para dejar un resumen verificable del evento.

#### Acceptance Criteria

1. WHEN un usuario con permiso solicita cerrar una actividad en estado finalizada, THE Activity_Service SHALL generar un resumen del corte que incluya el total de ingresos asociados, el total de egresos asociados, el resultado calculado como ingresos asociados menos egresos asociados, la lista de comprobantes asociados y el responsable de la actividad.
2. WHEN se genera el resumen del corte de una actividad, THE Activity_Service SHALL transicionar el estado de la actividad de finalizada a cerrada.
3. IF un usuario solicita cerrar una actividad y carece del permiso requerido para cerrar cortes, THEN THE Activity_Service SHALL rechazar la operación, conservar el estado y los datos de la actividad sin cambios, y devolver un error indicando falta de permiso.
4. IF un usuario solicita cerrar una actividad que ya se encuentra en estado cerrada, THEN THE Activity_Service SHALL rechazar la operación, conservar el resumen del corte existente sin cambios, y devolver un error indicando que el corte ya fue cerrado.
5. IF un usuario solicita cerrar una actividad que no se encuentra en estado finalizada, THEN THE Activity_Service SHALL rechazar la operación, conservar el estado de la actividad sin cambios, y devolver un error indicando que la actividad no está en un estado válido para el corte.
6. WHILE una actividad se encuentra en estado cerrada, THE Activity_Service SHALL impedir la modificación del resumen del corte y de los movimientos asociados, salvo mediante un ajuste autorizado que quede registrado en auditoría.

### Requirement 22: Cálculo de corte mensual (RF-100)

**User Story:** Como tesorero, quiero calcular el corte mensual, para conciliar el saldo teórico con el saldo real.

#### Acceptance Criteria

1. WHEN un usuario inicia un corte para una cuenta activa y un periodo válido, THE Cash_Closing_Service SHALL calcular el saldo teórico como el saldo inicial más la suma de los ingresos del periodo menos la suma de los egresos del periodo, con precisión monetaria de 2 decimales redondeando al centavo más cercano.
2. WHEN un usuario inicia un corte para una cuenta y periodo sin movimientos registrados en el ledger del periodo, THE Cash_Closing_Service SHALL calcular el saldo teórico igual al saldo inicial del periodo.
3. IF un usuario inicia un corte para una cuenta inexistente o inactiva, o para un periodo inexistente o no válido, THEN THE Cash_Closing_Service SHALL rechazar la operación, no crear ni modificar ningún corte, y devolver un mensaje de error indicando la causa (cuenta o periodo no válido).
4. WHEN un usuario captura el saldo real de un corte existente en estado abierto, THE Cash_Closing_Service SHALL calcular la diferencia como el saldo real capturado menos el saldo teórico, con precisión monetaria de 2 decimales redondeando al centavo más cercano.
5. IF un usuario captura el saldo real con un valor no numérico, negativo, o fuera del rango de 0.00 a 999,999,999.99, THEN THE Cash_Closing_Service SHALL rechazar la captura, conservar el saldo real previamente registrado, y devolver un mensaje de error indicando que el saldo real no es válido.

### Requirement 23: Flujo y cierre de corte mensual (RF-101)

**User Story:** Como presidente, quiero un flujo de revisión y cierre de cortes, para controlar la conciliación mensual.

#### Acceptance Criteria

1. THE Cash_Closing_Service SHALL representar el ciclo de vida de un corte con los estados abierto, en_revision, aprobado y cerrado.
2. WHEN un usuario con permiso cash_closings.close cierra un corte, THE Cash_Closing_Service SHALL transicionar el corte al estado cerrado.
3. IF un usuario intenta cerrar un corte que ya está cerrado, THEN THE Cash_Closing_Service SHALL rechazar la operación y devolver un mensaje de error.
4. WHEN se solicita un cambio retroactivo sobre un corte cerrado, THE Cash_Closing_Service SHALL requerir un ajuste autorizado y registrar el evento en auditoría.

### Requirement 24: Configurar campaña de bonos (RF-110)

**User Story:** Como administrador de comité, quiero configurar una campaña anual de bonos, para operar el sistema de bonos del año.

#### Acceptance Criteria

1. WHEN un administrador configura una campaña con año (entero de 4 dígitos, entre 2000 y 2100), cantidad de números (entero de 1 a 100000), número inicial (entero mayor o igual a 1), número final (entero menor o igual a 999999999), aportación mensual, premio mensual, meses activos y reglas de elegibilidad, THE Bonus_Campaign_Service SHALL registrar la campaña con estado inicial "borrador" (campaña no operativa) y devolver una confirmación de registro que identifique la campaña creada.
2. IF el número final es menor que el número inicial, THEN THE Bonus_Campaign_Service SHALL rechazar la configuración, no registrar la campaña y devolver un mensaje de validación que indique que el número final debe ser mayor o igual al número inicial.
3. IF la aportación mensual o el premio mensual es menor o igual a cero, THEN THE Bonus_Campaign_Service SHALL rechazar la configuración, no registrar la campaña y devolver un mensaje de validación que indique que ambos valores deben ser mayores que cero.
4. IF la cantidad de meses activos es menor que 1 o mayor que 12, THEN THE Bonus_Campaign_Service SHALL rechazar la configuración, no registrar la campaña y devolver un mensaje de validación que indique que los meses activos deben estar entre 1 y 12.
5. IF ya existe una campaña registrada para el mismo año, THEN THE Bonus_Campaign_Service SHALL rechazar la configuración, no registrar la campaña duplicada y devolver un mensaje de validación que indique que ya existe una campaña para ese año.

### Requirement 25: Generación de números (RF-111)

**User Story:** Como administrador de comité, quiero generar automáticamente los números de la campaña, para evitar captura manual.

#### Acceptance Criteria

1. WHEN un administrador solicita la generación de números al crear una campaña, THE Bonus_Campaign_Service SHALL crear los números configurados entre el número inicial y el número final.
2. THE Bonus_Campaign_Service SHALL mantener único cada número dentro de una campaña.

### Requirement 26: Beneficiario/titular con historial (RF-112)

**User Story:** Como administrador de comité, quiero asignar beneficiarios a los números con historial, para conservar la trazabilidad de titularidad.

#### Acceptance Criteria

1. THE Bonus_Campaign_Service SHALL mantener para cada número un beneficiario vigente y un historial de asignaciones con fechas de inicio y fin.
2. WHEN un administrador cambia el titular de un número, THE Bonus_Campaign_Service SHALL conservar la asignación anterior con su fecha de fin y crear una nueva asignación vigente.

### Requirement 27: Asignación de vendedores (RF-120)

**User Story:** Como administrador de comité, quiero asignar números a vendedores, para responsabilizar la cobranza.

#### Acceptance Criteria

1. WHEN un administrador asigna entre 1 y 500 números a un vendedor, THE Bonus_Campaign_Service SHALL registrar la asignación de vendedor con la fecha y hora de inicio correspondientes al momento de la operación.
2. IF una operación de asignación incluye un número o un vendedor que no existe, THEN THE Bonus_Campaign_Service SHALL rechazar la operación completa sin registrar ninguna asignación y devolver un mensaje de error que indique el número o vendedor no encontrado.
3. IF una operación de asignación incluye más de 500 números, THEN THE Bonus_Campaign_Service SHALL rechazar la operación sin registrar ninguna asignación y devolver un mensaje de error que indique que se excedió el máximo de 500 números por operación.
4. WHEN un administrador asigna un número que ya tiene un vendedor vigente, THE Bonus_Campaign_Service SHALL cerrar la asignación vigente previa registrando su fecha y hora de fin, y registrar la nueva asignación con fecha y hora de inicio.
5. THE Bonus_Campaign_Service SHALL mantener a lo sumo un vendedor vigente por número en un momento dado, entendiéndose por vigente la asignación cuya fecha de fin no ha sido registrada.

### Requirement 28: Estado por vendedor (RF-121)

**User Story:** Como tesorero, quiero ver el estado de cada vendedor, para conocer lo cobrado y lo pendiente por entregar.

#### Acceptance Criteria

1. THE Bonus_Collection_Service SHALL mostrar por vendedor los números asignados, el importe esperado, el importe cobrado, el importe entregado a tesorería, el pendiente por cobrar y el pendiente por entregar.

### Requirement 29: Mensualidades de bonos (RF-130)

**User Story:** Como administrador de bonos, quiero generar mensualidades por número y periodo, para dar seguimiento a los tres eventos del flujo del dinero.

#### Acceptance Criteria

1. WHEN se activa un periodo de campaña, THE Bonus_Collection_Service SHALL generar una mensualidad por cada número activo para ese periodo.
2. IF ya existe una mensualidad para un número y periodo, THEN THE Bonus_Collection_Service SHALL rechazar la creación de una segunda mensualidad para ese número y periodo.
3. THE Bonus_Collection_Service SHALL representar el ciclo de vida de una mensualidad con los estados pendiente, cobrado_vendedor, entregado_tesoreria y confirmado.
4. WHEN una mensualidad cambia de estado, THE Bonus_Collection_Service SHALL registrar la fecha, el usuario y la referencia de la transición.

### Requirement 30: Registro de cobro por vendedor (RF-130 evento de cobro)

**User Story:** Como vendedor, quiero registrar los cobros que realizo, para reflejar el dinero recibido de los beneficiarios.

#### Acceptance Criteria

1. WHEN un vendedor con permiso bonuses.collect registra un cobro de una mensualidad, THE Bonus_Collection_Service SHALL registrar el cobro y transicionar la mensualidad al estado cobrado_vendedor.
2. WHEN se registra un cobro, THE Bonus_Collection_Service SHALL abstenerse de incrementar el Derived_Balance del comité hasta que tesorería confirme la entrega.
3. IF el monto de un cobro es menor o igual a cero, THEN THE Bonus_Collection_Service SHALL rechazar el registro y devolver un mensaje de validación.

### Requirement 31: Reporte y confirmación de entregas (RF-131)

**User Story:** Como vendedor y como tesorero, quiero reportar y confirmar entregas, para incorporar el dinero al ledger con control de doble validación.

#### Acceptance Criteria

1. WHEN un vendedor reporta una entrega que agrupa uno o más cobros, THE Bonus_Settlement_Service SHALL registrar la entrega con estado "reportada" y con monto reportado igual a la suma de los montos de los cobros agrupados, dentro del rango 0.01 a 999,999,999.99.
2. IF un vendedor intenta reportar una entrega sin cobros agrupados o con un monto reportado distinto de la suma de los cobros agrupados o fuera del rango 0.01 a 999,999,999.99, THEN THE Bonus_Settlement_Service SHALL rechazar el reporte, no crear la entrega y devolver un mensaje de error indicando la causa del rechazo.
3. WHEN un usuario con permiso bonuses.settle distinto del vendedor que reportó confirma una entrega en estado "reportada", THE Bonus_Settlement_Service SHALL ejecutar de forma atómica la creación de una Financial_Transaction de ingreso con categoría Bonos, la transición de las mensualidades incluidas al estado "confirmado", el registro del monto confirmado y de la fecha y usuario de confirmación, y el cambio de la entrega al estado "confirmada".
4. IF el usuario que intenta confirmar una entrega es el mismo vendedor que la reportó, THEN THE Bonus_Settlement_Service SHALL rechazar la confirmación, conservar la entrega en estado "reportada" sin crear la Financial_Transaction y devolver un mensaje de error indicando que el confirmador no puede ser el reportador.
5. IF una entrega ya está en estado "confirmada", THEN THE Bonus_Settlement_Service SHALL rechazar cualquier confirmación adicional de la misma entrega, conservar la entrega en estado "confirmada" sin crear una segunda Financial_Transaction y devolver un mensaje de error indicando que la entrega ya fue confirmada.
6. WHEN la generación de la transacción de una entrega falla en cualquier paso, THE Bonus_Settlement_Service SHALL revertir la operación completa dejando la entrega en su estado "reportada" previo y sin cambios parciales en las mensualidades incluidas ni en las transacciones financieras.

### Requirement 32: Registrar sorteo (RF-140)

**User Story:** Como responsable de bonos, quiero registrar el sorteo del periodo, para determinar el número ganador con evidencia.

#### Acceptance Criteria

1. WHEN un usuario con permiso bonuses.draw registra un sorteo con campaña, periodo, fecha, número ganador, premio, responsable y evidencia, THE Bonus_Draw_Service SHALL registrar el sorteo y el beneficiario vigente del número ganador.
2. IF ya existe un sorteo para la misma campaña y periodo, THEN THE Bonus_Draw_Service SHALL rechazar el registro de un segundo sorteo salvo un procedimiento explícito de anulación.

### Requirement 33: Pago de premio (RF-141)

**User Story:** Como tesorero, quiero pagar el premio del sorteo, para entregar el premio con respaldo contable.

#### Acceptance Criteria

1. WHEN un usuario con permiso bonuses.draw confirma el pago de un premio para un sorteo registrado que no tiene pago previo, THE Bonus_Draw_Service SHALL generar de forma atómica un egreso con categoría Premio de bono vinculado al sorteo, con monto igual al premio del sorteo y mayor a 0.
2. IF un usuario intenta pagar el premio de un sorteo inexistente o no registrado, THEN THE Bonus_Draw_Service SHALL rechazar la operación, no generar ningún egreso, y devolver un mensaje de error indicando que el sorteo no existe.
3. IF un usuario sin el permiso requerido intenta confirmar el pago de un premio, THEN THE Bonus_Draw_Service SHALL rechazar la operación, no generar ningún egreso, y devolver un mensaje de error indicando falta de autorización.
4. IF un sorteo ya tiene un pago de premio registrado, THEN THE Bonus_Draw_Service SHALL rechazar un segundo pago de premio para ese sorteo, conservar el pago existente sin crear un nuevo egreso, y devolver un mensaje de error indicando que el premio ya fue pagado.
5. WHEN la generación del egreso de un pago de premio falla en cualquier paso, THE Bonus_Draw_Service SHALL revertir la operación completa sin dejar ningún egreso ni apunte de ledger parcial.

### Requirement 34: Reglas configurables de bonos (RF-142)

**User Story:** Como administrador de comité, quiero definir reglas de elegibilidad de bonos por campaña, para que el sistema no asuma reglas no acordadas.

#### Acceptance Criteria

1. THE Bonus_Campaign_Service SHALL permitir configurar, por comité y campaña, las reglas de elegibilidad para los siguientes seis parámetros: participación de números pendientes, fecha límite de pago para elegibilidad, repetición de ganador, tratamiento de premio no reclamado, cambio de beneficiario y cambio de vendedor.
2. WHEN un administrador de comité guarda la configuración de reglas de una campaña, THE Bonus_Campaign_Service SHALL persistir los seis parámetros junto con la fecha, el usuario y la campaña asociada, y marcar la campaña como con reglas definidas.
3. IF una regla de elegibilidad requerida no ha sido definida para una campaña, THEN THE Bonus_Draw_Service SHALL rechazar la ejecución del sorteo para esa campaña, no modificar ningún estado ni registro del sorteo, y devolver un mensaje de error indicando cuáles de los seis parámetros de reglas faltan por definir.
4. WHEN se ejecuta un sorteo de una campaña con los seis parámetros de reglas definidos, THE Bonus_Draw_Service SHALL determinar la elegibilidad de cada número aplicando exclusivamente las reglas configuradas para ese comité y campaña, sin aplicar valores predeterminados no configurados.

### Requirement 35: Corte mensual de bonos (RF-100/RF-101 bonos)

**User Story:** Como tesorero, quiero un corte mensual de bonos, para conciliar lo esperado, lo cobrado, lo entregado y los premios del periodo.

#### Acceptance Criteria

1. WHEN un usuario genera el corte mensual de bonos de un periodo, THE Report_Service SHALL mostrar por separado el total esperado, el total cobrado por vendedores, el total pendiente de cobro, el total entregado a tesorería, el total en poder de vendedores, el premio del periodo, el premio pagado o pendiente y el resultado de caja del periodo.

### Requirement 36: Auditoría inmutable (RF-150)

**User Story:** Como auditor, quiero un registro de auditoría inmutable, para verificar quién hizo qué y cuándo.

#### Acceptance Criteria

1. WHEN un usuario ejecuta una operación sensible (crear, modificar o eliminar un registro de una entidad sujeta a auditoría), THE Audit_Service SHALL crear un registro de auditoría que incluya comité, usuario, fecha/hora con precisión de al menos segundos, acción, entidad afectada, registro afectado, valor anterior, valor nuevo y, cuando la operación sea una eliminación o un ajuste retroactivo, el motivo.
2. IF una operación normal de la aplicación (cualquier operación distinta de la creación de registros de auditoría por el propio Audit_Service) intenta modificar o eliminar un registro de auditoría, THEN THE Audit_Service SHALL rechazar la operación, conservar el registro de auditoría sin cambios y devolver una indicación de error señalando que los registros de auditoría son inmutables.
3. IF una operación sensible no puede atribuirse a un usuario identificado y a una fecha/hora, THEN THE Audit_Service SHALL rechazar la operación sensible sin aplicar sus cambios y devolver una indicación de error señalando que falta la información de atribución.
4. IF la creación del registro de auditoría de una operación sensible falla, THEN THE Audit_Service SHALL revertir la operación sensible de forma que no queden cambios aplicados sin su registro de auditoría correspondiente.
5. WHERE el usuario tiene rol de auditor, THE Audit_Service SHALL permitir la consulta de los registros de auditoría en modo solo lectura, sin permitir su creación, modificación ni eliminación.

### Requirement 37: Reportes básicos y exportaciones

**User Story:** Como tesorero o presidente, quiero generar reportes y exportarlos, para rendir cuentas y analizar la operación.

#### Acceptance Criteria

1. WHEN un usuario con permiso reports.read solicita un reporte, THE Report_Service SHALL generar el reporte restringido al comité activo del usuario.
2. WHEN un usuario exporta un reporte, THE Report_Service SHALL producir el archivo en el formato solicitado dentro del conjunto PDF, XLSX o CSV.

### Requirement 38: Dashboard con indicadores

**User Story:** Como responsable de comité, quiero un dashboard con indicadores clave, para conocer el estado financiero de un vistazo.

#### Acceptance Criteria

1. WHEN un usuario abre el dashboard de su comité, THE Dashboard_Service SHALL mostrar el saldo consolidado, el saldo por cuenta, los ingresos del mes, los egresos del mes, el resultado del mes, los miembros activos, los bonos cobrados por vendedores, lo entregado a tesorería, el dinero pendiente de entregar y los comprobantes faltantes.
2. THE Dashboard_Service SHALL calcular los indicadores restringidos al `committee_id` del usuario.

### Requirement 39: Portal de vendedor mobile-first

**User Story:** Como vendedor, quiero un portal móvil con mis asignaciones, para registrar cobros y reportar entregas desde el teléfono.

#### Acceptance Criteria

1. WHEN un vendedor autenticado accede al Seller_Portal, THE Seller_Portal SHALL mostrar únicamente los números asignados a ese vendedor dentro del comité activo, junto con el importe cobrado, el importe por cobrar y el importe por entregar del periodo seleccionado, cada uno expresado en el rango de 0.00 a 999,999,999.99.
2. WHILE un vendedor tiene una sesión activa en el Seller_Portal, THE Seller_Portal SHALL ofrecer las acciones registrar cobro y reportar entrega restringidas a las asignaciones de ese vendedor.
3. WHEN un vendedor registra un cobro con un importe entre 0.01 y 999,999,999.99 para una asignación propia, THE Seller_Portal SHALL registrar el cobro asociado a esa asignación e indicar al vendedor que el registro fue completado.
4. IF un vendedor registra un cobro con importe fuera del rango de 0.01 a 999,999,999.99 o sin seleccionar una asignación propia, THEN THE Seller_Portal SHALL rechazar el registro, no persistir ningún cobro y mostrar un mensaje indicando el motivo del rechazo.
5. WHEN un vendedor reporta una entrega que agrupa uno o más cobros propios, THE Seller_Portal SHALL registrar la entrega en estado reportado, sin permitir que el vendedor confirme su propia recepción, e indicar al vendedor que el reporte fue completado.
6. IF una solicitud del vendedor de registrar cobro o reportar entrega no puede completarse por falla del servicio o dependencia no disponible, THEN THE Seller_Portal SHALL preservar los datos previos sin cambios y mostrar un mensaje indicando que la operación no pudo completarse.
7. IF un vendedor solicita datos u operaciones sobre asignaciones que no le pertenecen o que pertenecen a otro comité, THEN THE Authorization_Service SHALL denegar el acceso y no exponer los datos solicitados.

### Requirement 40: Seguridad (RNF-001)

**User Story:** Como responsable de seguridad, quiero controles de seguridad de plataforma, para proteger los datos y las operaciones críticas.

#### Acceptance Criteria

1. WHERE el entorno es producción, THE SAC SHALL servir todas las solicitudes sobre HTTPS.
2. THE SAC SHALL aplicar RLS en las tablas multi-tenant y RBAC de mínimo privilegio en las operaciones de escritura.
3. THE SAC SHALL restringir el uso de las service keys al servidor y abstenerse de exponerlas al navegador.
4. THE Attachment_Service SHALL almacenar los comprobantes en buckets privados accesibles únicamente mediante Signed_URL.
5. WHEN una operación crítica supera el umbral de solicitudes configurado, THE SAC SHALL aplicar rate limiting a esa operación.

### Requirement 41: Integridad financiera (RNF-002)

**User Story:** Como tesorero, quiero garantías de integridad financiera, para confiar en la exactitud del ledger.

#### Acceptance Criteria

1. THE Ledger_Service SHALL almacenar los montos en tipo numérico exacto y abstenerse de usar tipos de punto flotante.
2. WHEN una operación financiera genera múltiples apuntes de ledger, THE Transaction_Service SHALL ejecutar la operación dentro de una transacción atómica de base de datos.
3. IF una transacción atómica falla en cualquier paso, THEN THE Transaction_Service SHALL revertir todos los cambios de la operación.
4. WHEN un proceso automático de contabilización se ejecuta más de una vez con la misma referencia, THE Transaction_Service SHALL generar como máximo una transacción financiera para esa referencia.

### Requirement 42: Usabilidad mobile-first (RNF-004)

**User Story:** Como usuario en campo, quiero una interfaz mobile-first, para capturar operaciones de forma rápida y segura.

#### Acceptance Criteria

1. THE SAC SHALL presentar una interfaz responsiva con diseño mobile-first.
2. WHEN un usuario captura un ingreso o egreso, THE SAC SHALL validar los campos de forma inmediata antes de permitir el envío.
3. WHEN un usuario ejecuta una acción crítica, THE SAC SHALL requerir una confirmación explícita antes de ejecutarla.

### Requirement 43: Disponibilidad PWA multi-dispositivo (RNF-005)

**User Story:** Como usuario, quiero usar el sistema como PWA, para acceder desde computadora, tablet, Android e iPhone.

#### Acceptance Criteria

1. THE SAC SHALL operar como PWA responsiva compatible con computadora, tablet, Android e iPhone.

### Requirement 44: Escalabilidad multi-tenant y respaldos (RNF-006, RNF-007)

**User Story:** Como administrador de plataforma, quiero escalar a nuevos comités y respaldar los datos, para crecer sin instalaciones separadas y con recuperación ante fallos.

#### Acceptance Criteria

1. WHEN se incorpora un nuevo comité, THE SAC SHALL habilitarlo dentro de la misma aplicación y base de datos sin requerir una instalación independiente.
2. THE SAC SHALL ejecutar respaldos programados de la base de datos PostgreSQL y una estrategia independiente de respaldo de comprobantes.

### Requirement 45: Rendimiento del dashboard (RNF-008)

**User Story:** Como usuario, quiero que el dashboard responda con rapidez, para consultar indicadores sin demoras.

#### Acceptance Criteria

1. WHEN el Dashboard_Service calcula indicadores, THE Dashboard_Service SHALL usar agregaciones e índices del lado del servidor y abstenerse de calcular históricos completos en el cliente.

## Out of Scope (Fuera del MVP)

Las siguientes capacidades quedan explícitamente fuera del MVP y no se abordan en estos requerimientos:

- OCR/IA de comprobantes.
- Asistente financiero conversacional.
- Detección de anomalías mediante IA.
- Aplicaciones móviles nativas.
- Cobros electrónicos integrados.
- Portal público avanzado de transparencia.

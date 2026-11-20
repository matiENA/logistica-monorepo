# Reglas del Workspace (AGENTS.md)

## Flujo de Trabajo Git (Commit & Push)

Al concluir cualquier tarea o modificación de código, documentación o configuración:
1. **Ofrecer siempre la opción de commit y push**: Preguntar al usuario si desea versionar y subir los cambios.
2. **Proporcionar comandos listos para Windows PowerShell 5.1 desde el directorio predeterminado (`PS C:\Users\Matias Rodriguez>`)**:
   - Declarar siempre al inicio la ruta absoluta del repositorio con `Set-Location "<ruta_absoluta_del_repo>"` (compatible con PowerShell 5.1, sin `&&`).
   - Entregar **siempre 2 opciones** con mensaje Conventional Commit y `git push origin <rama_activa>`:
     - **Opción 1 (Solo los cambios de esta tarea)**: `git add` explícito únicamente de los archivos creados/modificados en la intervención actual.
     - **Opción 2 (Todo el directorio del microservicio/app intervenido)**: `git add "<ruta_relativa_microservicio>"` (ej. `"apps/dash-frontend"` o `"services/master-service/node_backend"`).
3. **Control del usuario**: No ejecutar `commit` ni `push` automáticamente a menos que el usuario lo pida expresamente.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliUsageError } from "./errors.js";

const execute = promisify(execFile);

// Only paths and the operation cross the process boundary; credential contents
// never do. Prints `private` or `shared` for each path, in order.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($path in ($env:AREX_CREDENTIAL_PATHS -split "\`n")) {
  if ($env:AREX_CREDENTIAL_OPERATION -eq 'restrict') {
    if ($env:AREX_CREDENTIAL_DIRECTORY -eq 'true') {
      $acl = New-Object System.Security.AccessControl.DirectorySecurity
      $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
      $acl = New-Object System.Security.AccessControl.FileSecurity
      $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $path -AclObject $acl
  }
  $actual = Get-Acl -LiteralPath $path
  $private = $actual.AreAccessRulesProtected -and ($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value)
  $hasFullControl = $false
  foreach ($rule in $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
      if ($rule.IdentityReference.Value -ne $sid.Value) { $private = $false }
      if (($rule.IdentityReference.Value -eq $sid.Value) -and (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)) { $hasFullControl = $true }
    } elseif ($rule.IdentityReference.Value -eq $sid.Value) {
      $private = $false
    }
  }
  if ($private -and $hasFullControl) { 'private' } else { 'shared' }
}
`;

/**
 * Whether only the current Windows user can access every path. With
 * `restrict`, first replaces each path's ACL with owner-only full control.
 * One PowerShell process handles all paths, because starting it is slow.
 */
export async function windowsCredentialPermissions(
	paths: string[],
	restrict?: "file" | "directory",
): Promise<boolean> {
	let stdout: string;
	try {
		({ stdout } = await execute(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(SCRIPT, "utf16le").toString("base64"),
			],
			{
				env: {
					...process.env,
					AREX_API_KEY: undefined,
					AREX_CREDENTIAL_PATHS: paths.join("\n"),
					AREX_CREDENTIAL_OPERATION: restrict ? "restrict" : "inspect",
					AREX_CREDENTIAL_DIRECTORY: String(restrict === "directory"),
				},
				windowsHide: true,
				// A cold or busy machine can take tens of seconds to start PowerShell.
				timeout: 60_000,
				maxBuffer: 64 * 1024,
			},
		));
	} catch (error) {
		if (
			!(error instanceof Error) ||
			(!("code" in error) && !("killed" in error))
		)
			throw error;
		throw new CliUsageError(
			"Could not inspect or secure Windows credential permissions. Ensure PowerShell is available and your account owns the configuration directory and file, then rerun arex setup.",
		);
	}
	const results = stdout.trim().split(/\r?\n/);
	if (
		results.length !== paths.length ||
		results.some((result) => result !== "private" && result !== "shared")
	)
		throw new Error(
			"Windows credential permission inspection returned an unexpected result.",
		);
	const isPrivate = results.every((result) => result === "private");
	if (restrict && !isPrivate)
		throw new CliUsageError(
			"Could not restrict Windows credential access to the current user. No credential was written.",
		);
	return isPrivate;
}

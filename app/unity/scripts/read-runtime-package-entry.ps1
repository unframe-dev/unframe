param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$Entry,
    [Parameter(Mandatory = $true)][long]$Limit,
    [switch]$IgnoreCase
)
$ErrorActionPreference = 'Stop'
$package = [System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
    $member = $package.GetEntry($Entry)
    if ($IgnoreCase) {
        $member = $package.Entries | Where-Object { $_.FullName -ieq $Entry } | Select-Object -First 1
    }
    if ($null -eq $member) { throw "Package entry missing: $Entry" }
    if ($member.Length -gt $Limit) { throw "Package entry exceeds $Limit bytes" }
    $stream = $member.Open()
    try {
        $output = [Console]::OpenStandardOutput()
        $buffer = [byte[]]::new(65536)
        $total = 0L
        while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt $Limit) { throw "Package entry exceeds $Limit bytes" }
            $output.Write($buffer, 0, $count)
        }
    }
    finally { $stream.Dispose() }
}
finally { $package.Dispose() }

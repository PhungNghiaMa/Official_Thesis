# Define the path to your toktx executable
$toktxPath = "C:\Program Files\KTX-Software\bin\toktx.exe"

# Define the folder that contains your texture files (input)
$inputFolder = "..\..\public/assets\art_gallery\Virtual_Art_Gallery_3"

# Define the folder where you want to store the encoded images (output)
$outputFolder = "..\..\public\assets\art_gallery\EncodeTexture"

# Create the output folder if it doesn't exist
if (-not (Test-Path -Path $outputFolder)) {
    New-Item -ItemType Directory -Path $outputFolder
}

# Specify the file extensions to convert
$fileExtensions = "*.png", "*.jpg", "*.webp"

# Loop through each file extension
foreach ($ext in $fileExtensions) {
    # Get all files with the current extension from the input folder
    Get-ChildItem -Path $inputFolder -Filter $ext | ForEach-Object {
        # Get the base name of the file
        $fileName = $_.BaseName
        
        # Define the output file path in the new output folder
        $outputFile = Join-Path -Path $outputFolder -ChildPath "$fileName.ktx2"
        
        # Run the toktx command to encode the image
        & $toktxPath --bcmp --t2 --genmipmap --target_type RGBA $outputFile $_.FullName
        
        Write-Host "Converted $_.Name to $outputFile"
    }
}
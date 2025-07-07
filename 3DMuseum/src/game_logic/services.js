
const BACKEND_URL =
  import.meta.env.MODE === "production"
    ? import.meta.env.VITE_PROD_BACKEND_URL // Use VITE_ prefix
    : import.meta.env.VITE_BACKEND_URL;     // Use VITE_ prefix

// API FETCH ALL INFORMATION FOR SPECIFIC ROOM
export async function GetRoomAsset(roomID) {
    const url = `${BACKEND_URL}/list/${roomID}`
    const response =  await fetch(url, {
        method: 'GET'
    })
    return await response.json()
}


const validateData = (data) => {

	if (!data.title || data.title.length > 40) {
		return 'Title is required and must be at most 40 characters.'
	}
	if (!data.vietnamese_description || data.vietnamese_description.length > 500) {
		return 'Vietnamese description is required and must be at most 500 characters.'
	}
	if (!data.english_description.length || data.english_description.length > 500) {
		return 'English description is required and must be at most 500 characters.'
	}
	return ''
}

export const UploadItem = async (file, mesh_name , title, vietnamese_description, english_description, roomID) => {
    const formData = new FormData()

    const error = validateData({ title, vietnamese_description, english_description })

    if (error !== '') {
        console.log("error: ", error)
        throw new Error(error)
    }

    // Append the file to the form data. The browser will automatically include the filename.
    // The backend should extract the filename from this 'file' part of the request.
    formData.append('file', file)
    formData.append('mesh_name', mesh_name)
    formData.append('title', title)
    formData.append('vietnamese_description', vietnamese_description)
    formData.append('english_description', english_description)
    formData.append('roomID', roomID)

    try {
        const response = await fetch(`${BACKEND_URL}/upload`, {
            method: 'POST',
            body: formData
        })

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error: ${response.status} ${response.statusText} - ${errorText}`)
        }

        const result = await response.json()
        return result
    } catch (error) {
        console.error('Error uploading item:', error)
        throw error
    }
}


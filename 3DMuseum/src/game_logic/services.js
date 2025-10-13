
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

// WEBSOCKET
let _ws = null 
const _subscribed = new Set()
let _reconnectTimer = null 

function wsURL(){
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${BACKEND_URL}/ws`;
}

export function StartWebSocket(){
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return _ws;
    _ws = new WebSocket(wsURL())

    // Open ws connection 
    _ws.onopen = () => {
        console.info("[WS] CONNECTED")
        // re-subcribed previously requested channels
        for (const channel of Array.from(_subscribed)){
            try {_ws.send(JSON.stringify({action: "subsribe", channel: channel}));}
            catch (e){console.error("ERROR IN SUBSRIBE TO CHANNEL: ",e)}
        }
    };

    _ws.onmessage = (evt) =>{
        try {
            const message = JSON.parse(evt.data)
            // re-dispatch as a CustomeEvent for app to listen to 
            window.dispatchEvent(new CustomeEvent("ws:progress", {detail: message}));
            // auto subscribe to asset channel when we have asset__cid
            if (message && message.asset_cid){
                const assetChannel = `asset:${message.asset_cid}`;
                // set up so program not spam the subsribe if we already have it 
                if (!_subscribed.has(assetChannel)) SubscribeChannel(assetChannel)
            }
        }catch (e){
            console.error("[WS] INVALIDE MESSAGE: ",e)
        }
    }

    _ws.onclose = () => {
        console.log("[WS] DISCONNECTED")
        _ws = null ;
        // try to reconnect with the backoff
        if (_reconnectTimer == null){
            _reconnectTimer = setTimeout(() => {
                _reconnectTimer = null ;
                StartWebSocket();
            } , 2000)
        }
    }

    _ws.onerror = (e) => {
        console.error("[WS] ERROR: ",e)
    }

    return _ws;
}

export function  SubscribeChannel(channel){
    StartWebSocket();
    if (!channel) return;
    if (_subscribed.has(channel)) return;
    // Push channel want to subcribe to the _subscribe set 
    _subscribed.add(channel);
    try{
        _ws.send(JSON.stringify({action:"subscribe", channel}))
    }catch(e){
        console.error("[WS] FAIL TO SUBSRIBE TO CHANNLE: ", e)
    }
}

export function unsubscribeChannel(channel) {
  if (!_ws) return;
  _subscribed.delete(channel);
  try {
    _ws.send(JSON.stringify({ action: "unsubscribe", channel }));
  } catch (e) {}
}

export function closeWebSocket() {
  if (_ws) _ws.close();
  _ws = null;
  _subscribed.clear();
}



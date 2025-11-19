// This cache is use to avoi re-decoding same audio 
const audioDecodeCache = new Map() 

// We use lightweight OfflineAudioContext for decoding in the background
const decodingContext = new OfflineAudioContext(1,1,44100)

self.onmessage = async (event) =>{
    const {cid , url } = event.data;

    if (!cid || !url ) return ; // ignore invalid message

    // If we've already processed this CID , ignore and do not process it again
    if (audioDecodeCache.has(cid)) return;

    try {
        console.log("[WORKER] receive job for CID: ", cid);
        const response = await fetch(url);
        if (!response.ok){
            throw new Error(`Fetch failed for ${cid} with status ${response.status}`);
        }
        // Convert fetch audio to Buffer
        const audioData = response.arrayBuffer();
        // Decode the receive Buffer into Audio data
        const audioBuffer = await decodingContext.decodeAudioData(audioData)
        // Store the result in worker's local cache
        audioDecodeCache.set(cid , audioBuffer);

        // Send result back to main thread 
        // The second argument is a list of "Transferable" objects.
        // This moves the data with zero-copy, which is extremely fast and efficient.
        self.postMessage({
            type: "DECODE_SUCCESS",
            cid: cid,
            audioBuffer: audioBuffer
        }, [audioBuffer.getChannelData(0).buffer]);  // Transfer ownership of underlying data
    }catch (error){
        console.error(`[Worker] Error processing CID ${cid}:`, error);
        // Notify the main thread of the failure so it can handle it gracefully.
        self.postMessage({
            type: 'DECODE_ERROR',
            cid: cid,
            message: error.message
        });
    }
}
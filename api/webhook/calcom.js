export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN;
    const PIPELINE_ID = process.env.PIPEDRIVE_PIPELINE_ID;
    const STAGE_ID = process.env.PIPEDRIVE_STAGE_ID;
    const PIPEDRIVE_DOMAIN = "https://api.pipedrive.com/v1";

    try {
        const payload = req.body.payload;
        const attendee = payload?.attendees?.[0];

        if (!attendee) {
            return res.status(400).json({ error: "No attendee found" });
        }

        const attendeeName = attendee.name;
        const attendeeEmail = attendee.email;
        const eventTitle = payload.title || "Cal.com Booking";
        const startTime = payload.startTime;

        // 1. Search for existing person by email
        const searchRes = await fetch(
            `${PIPEDRIVE_DOMAIN}/persons/search?term=${encodeURIComponent(attendeeEmail)}&api_token=${PIPEDRIVE_API_TOKEN}`
        );
        const searchData = await searchRes.json();

        let personId;

        if (searchData.data?.items?.length > 0) {
            personId = searchData.data.items[0].item.id;
        } else {
            // 2. Create new person
            const personRes = await fetch(
                `${PIPEDRIVE_DOMAIN}/persons?api_token=${PIPEDRIVE_API_TOKEN}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: attendeeName,
                        email: [{ value: attendeeEmail, primary: true }],
                    }),
                }
            );
            const personData = await personRes.json();
            personId = personData.data.id;
        }

        // 3. Create deal
        const dealRes = await fetch(
            `${PIPEDRIVE_DOMAIN}/deals?api_token=${PIPEDRIVE_API_TOKEN}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: `${eventTitle} - ${attendeeName}`,
                    person_id: personId,
                    pipeline_id: parseInt(PIPELINE_ID),
                    stage_id: parseInt(STAGE_ID),
                }),
            }
        );
        const dealData = await dealRes.json();

        // 4. Add a note with booking details
        if (dealData.data?.id) {
            await fetch(
                `${PIPEDRIVE_DOMAIN}/notes?api_token=${PIPEDRIVE_API_TOKEN}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        deal_id: dealData.data.id,
                        content: `Booking via Cal.com\nEvent: ${eventTitle}\nTime: ${startTime}\nAttendee: ${attendeeName} (${attendeeEmail})`,
                    }),
                }
            );
        }

        console.log("Deal created:", dealData.data?.id);
        return res.status(200).json({
            success: true,
            deal_id: dealData.data?.id,
        });
    } catch (error) {
        console.error("Webhook error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}
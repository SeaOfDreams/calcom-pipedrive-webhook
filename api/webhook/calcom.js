export default async function handler(req, res) {
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
        const responses = payload?.responses || {};

        if (!attendee) {
            return res.status(400).json({ error: "No attendee found" });
        }

        // Extract fields from Cal.com
        const attendeeName = attendee.name;
        const attendeeEmail = attendee.email;
        const company = responses.Azienda?.value || "";
        const role = responses.ruolo?.value || "";
        const companySize = responses.dimensioni_azienda?.value || "";
        const website = responses.sito_web?.value || "";
        const notes = responses.notes?.value || "";
        const eventTitle = payload.title || "Cal.com Booking";
        const startTime = payload.startTime;
        const meetLink = payload.metadata?.videoCallUrl || "";

        // 1. Create organization if company provided
        let orgId;
        if (company) {
            const orgRes = await fetch(
                `${PIPEDRIVE_DOMAIN}/organizations?api_token=${PIPEDRIVE_API_TOKEN}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: company }),
                }
            );
            const orgData = await orgRes.json();
            orgId = orgData.data?.id;
        }

        // 2. Search for existing person
        const searchRes = await fetch(
            `${PIPEDRIVE_DOMAIN}/persons/search?term=${encodeURIComponent(attendeeEmail)}&api_token=${PIPEDRIVE_API_TOKEN}`
        );
        const searchData = await searchRes.json();

        let personId;

        if (searchData.data?.items?.length > 0) {
            personId = searchData.data.items[0].item.id;
        } else {
            const personBody = {
                name: attendeeName,
                email: [{ value: attendeeEmail, primary: true }],
            };
            if (orgId) personBody.org_id = orgId;

            const personRes = await fetch(
                `${PIPEDRIVE_DOMAIN}/persons?api_token=${PIPEDRIVE_API_TOKEN}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(personBody),
                }
            );
            const personData = await personRes.json();
            personId = personData.data.id;
        }

        // 3. Create deal
        const dealBody = {
            title: `${eventTitle} - ${attendeeName}`,
            person_id: personId,
            pipeline_id: parseInt(PIPELINE_ID),
            stage_id: parseInt(STAGE_ID),
        };
        if (orgId) dealBody.org_id = orgId;

        const dealRes = await fetch(
            `${PIPEDRIVE_DOMAIN}/deals?api_token=${PIPEDRIVE_API_TOKEN}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dealBody),
            }
        );
        const dealData = await dealRes.json();

        // 4. Add detailed note
        if (dealData.data?.id) {
            const noteLines = [
                `<b>📅 Prenotazione via Cal.com</b>`,
                ``,
                `<b>Evento:</b> ${eventTitle}`,
                `<b>Data/Ora:</b> ${startTime}`,
                meetLink ? `<b>Link Meet:</b> ${meetLink}` : null,
                ``,
                `<b>👤 Contatto</b>`,
                `<b>Nome:</b> ${attendeeName}`,
                `<b>Email:</b> ${attendeeEmail}`,
                role ? `<b>Ruolo:</b> ${role}` : null,
                ``,
                `<b>🏢 Azienda</b>`,
                company ? `<b>Azienda:</b> ${company}` : null,
                companySize ? `<b>Dimensioni:</b> ${companySize}` : null,
                website ? `<b>Sito Web:</b> ${website}` : null,
                notes ? `<br><b>📝 Note:</b> ${notes}` : null,
            ]
                .filter(Boolean)
                .join("<br>");

            await fetch(
                `${PIPEDRIVE_DOMAIN}/notes?api_token=${PIPEDRIVE_API_TOKEN}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        deal_id: dealData.data.id,
                        content: noteLines,
                    }),
                }
            );
        }

        // 5. Create activity (call) with reminder
        if (dealData.data?.id) {
            const startDate = new Date(startTime);
            const endTimeStr = payload.endTime || new Date(startDate.getTime() + 30 * 60000).toISOString();
            const endDate = new Date(endTimeStr);

            await fetch(
                `${PIPEDRIVE_DOMAIN}/activities?api_token=${PIPEDRIVE_API_TOKEN}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        subject: `Call - ${attendeeName}`,
                        type: "call",
                        deal_id: dealData.data.id,
                        person_id: personId,
                        due_date: startDate.toISOString().split("T")[0],
                        due_time: startDate.toTimeString().slice(0, 5),
                        duration: endDate.toTimeString().slice(0, 5),
                        note: `Prenotato via Cal.com${meetLink ? "\nMeet: " + meetLink : ""}`,
                        done: 0,
                    }),
                }
            );
        }

        return res.status(200).json({
            success: true,
            deal_id: dealData.data?.id,
            person_id: personId,
            org_id: orgId || null,
        });
    } catch (error) {
        console.error("Webhook error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}
const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dontenv.config();
const uri = process.env.MONGODB_URI;
const app = express();
const PORT = process.env.PORT;
app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const db = client.db("wisdom-vault");
    const lessonsCollection = db.collection('users');

    //  users 

    router.post("/api/lessons", async (req, res) => {
      try {
        const {
          title,
          description,
          category,
          emotionalTone,
          accessLevel,
          image,
          userId,
          creatorName,
          creatorPhoto,
        } = req.body;

        // Basic validation
        if (!title || !description || !userId) {
          return res.status(400).send({
            success: false,
            message: "Title, description and userId are required",
          });
        }

        const newLesson = {
          title,
          description,
          category: category || "Personal Growth",
          emotionalTone: emotionalTone || "Motivational",
          visibility: "Public",
          accessLevel: accessLevel === "Premium" ? "Premium" : "Free",
          image: image || "",
          creatorId: userId,
          creatorName: creatorName || "",
          creatorPhoto: creatorPhoto || "",
          likes: [],
          likesCount: 0,
          isFeatured: false,
          isReviewed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await lessonsCollection.insertOne(newLesson);

        res.send({
          success: true,
          message: "Lesson added successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding lesson:", error);
        res.status(500).send({
          success: false,
          message: "Failed to add lesson",
        });
      }
    });


   





    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

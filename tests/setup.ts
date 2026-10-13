// Charge .env pour les tests d'intégration. Aucune valeur n'est affichée.
import "dotenv/config";

// Les tests d'intégration n'utilisent JAMAIS la base de développement : le journal d'audit est en ajout seul
// et ne peut pas être nettoyé. Sans TEST_DATABASE_URL, ils sont ignorés.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

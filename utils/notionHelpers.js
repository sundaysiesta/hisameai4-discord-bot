const { Client: NotionClient } = require('@notionhq/client');
const config = require('../config');

const notion = new NotionClient({ auth: config.NOTION_API_KEY });

const getNotionPropertyText = (property) => {
    if (!property) return 'N/A';
    switch (property.type) {
        case 'rich_text':
            return property.rich_text[0]?.plain_text || 'N/A';
        case 'select':
            return property.select?.name || 'N/A';
        case 'status':
            return property.status?.name || 'N/A';
        case 'multi_select':
            return property.multi_select.map(item => item.name).join(', ') || 'N/A';
        case 'title':
            return property.title[0]?.plain_text || 'N/A';
        case 'formula':
            return property.formula.string || property.formula.number?.toString() || 'N/A';
        default:
            return 'N/A';
    }
};

const getNotionRelationData = async (notion, relationProperty, datePropertyName) => {
    if (!relationProperty || !relationProperty.relation || relationProperty.relation.length === 0) {
        return [];
    }
    try {
        const dataPromises = relationProperty.relation.map(async (relation) => {
            try {
                const page = await notion.pages.retrieve({ page_id: relation.id });
                const titleProp = Object.values(page.properties).find(prop => prop.type === 'title');
                const title = titleProp ? titleProp.title[0]?.plain_text : null;
                
                const dateProp = page.properties[datePropertyName];
                const date = dateProp && dateProp.type === 'date' && dateProp.date ? dateProp.date.start : null;

                if (title) {
                    return { title, date };
                }
                return null;
            } catch (pageError) {
                console.error(`Failed to retrieve related page ${relation.id}:`, pageError);
                return null;
            }
        });
        const results = await Promise.all(dataPromises);
        return results.filter(item => item !== null);
    } catch (error) {
        console.error("Failed to retrieve relation data:", error);
        return [];
    }
};

const getNotionRelationTitles = async (notion, relationProperty) => {
    const data = await getNotionRelationData(notion, relationProperty);
    return data.map(item => item.title);
};

// 【最重要修正】getNotionRelationTitles をエクスポートリストに追加
module.exports = { notion, getNotionPropertyText, getNotionRelationTitles, getNotionRelationData };


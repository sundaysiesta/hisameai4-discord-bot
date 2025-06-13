const getNotionPropertyText = (property) => {
    if (!property) return 'N/A';
    switch (property.type) {
        case 'rich_text': return property.rich_text[0]?.plain_text || 'N/A';
        case 'select': return property.select?.name || 'N/A';
        case 'status': return property.status?.name || 'N/A';
        case 'multi_select': return property.multi_select.map(item => item.name).join(', ') || 'N/A';
        case 'title': return property.title[0]?.plain_text || 'N/A';
        case 'formula': return property.formula.string || property.formula.number?.toString() || 'N/A';
        default: return 'N/A';
    }
};

const getNotionRelationTitles = async (notion, relationProperty) => {
    if (!relationProperty || !relationProperty.relation || relationProperty.relation.length === 0) return [];
    try {
        const titlePromises = relationProperty.relation.map(async (relation) => {
            const page = await notion.pages.retrieve({ page_id: relation.id });
            const titleProp = Object.values(page.properties).find(prop => prop.type === 'title');
            return titleProp ? titleProp.title[0]?.plain_text : null;
        });
        const titles = await Promise.all(titlePromises);
        return titles.filter(title => title !== null);
    } catch (error) {
        console.error("Failed to retrieve relation titles:", error);
        return [];
    }
};

module.exports = { getNotionPropertyText, getNotionRelationTitles };
